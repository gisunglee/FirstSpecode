/**
 * billing/gateway — PG(결제 게이트웨이) 인터페이스 + 구현 선택
 *
 * 역할:
 *   - 토스페이먼츠 빌링(자동결제) API 모양에 맞춘 추상 인터페이스
 *   - 구현은 두 개: Mock(gateway-mock.ts, 기본) / Toss(gateway-toss.ts, 2026-09-30 추가)
 *   - 환경변수 PAYMENT_GATEWAY=mock|toss 로 선택. 미설정 = mock
 *
 * 왜 인터페이스 뒤에 두는가:
 *   PG 가 뜨는 지점(카드 등록창·빌링키 발급·청구·취소·웹훅)만 갈아 끼우면 나머지
 *   구독·좌석·잠금·배치 코드가 그대로 돈다. 운영 사용자가 회사 내부 인원뿐인 동안은
 *   운영에서도 Mock 을 쓴다(정책 §3 2단계 원칙). 토스 전환 = PAYMENT_GATEWAY=toss + 키 env + 재배포.
 *
 * 두 구현의 차이 (호출자가 mode 로 분기하는 유일한 지점은 카드 등록 시작):
 *   - Mock: startCardRegistration → { mode:"redirect", url } — 앱 안 "PG 창"으로 이동
 *   - Toss: startCardRegistration → { mode:"sdk", clientKey, customerKey, successUrl, failUrl }
 *     (토스 카드 등록은 브라우저 SDK requestBillingAuth 가 띄운다 — 서버 리다이렉트 URL 이 아님)
 *   - 빌링키 삭제 API 는 토스에 없다 → 우리 DB 에서 NULL 처리로 끝 (인터페이스에 없음)
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { PG_PROVIDER, type PgProviderCode } from "./constants";
import { MockPaymentGateway } from "./gateway-mock";
import { TossPaymentGateway } from "./gateway-toss";

// ─── 타입 ────────────────────────────────────────────────────────────────────

/**
 * 카드 등록 시작 결과.
 *   redirect — 서버가 준 URL 로 브라우저를 보낸다 (Mock "PG 창")
 *   sdk      — 브라우저 SDK 가 창을 띄운다 (토스). 프론트 버튼이 mode 로 분기
 */
export type CardRegistrationStart =
  | { mode: "redirect"; url: string }
  /** 토스: 프론트가 requestBillingAuth(successUrl, failUrl) 를 부른다 — URL 은 서버가 만든 것을 그대로 쓴다 */
  | { mode: "sdk"; clientKey: string; customerKey: string; successUrl: string; failUrl: string };

export type StartCardRegistrationParams = {
  customerKey: string;
  /** PG 가 authKey·customerKey 를 붙여 돌려보낼 앱 URL (절대 경로) */
  successUrl:  string;
  failUrl:     string;
};

export type IssueBillingKeyParams = {
  authKey:     string;
  customerKey: string;
};

export type IssuedBillingKey = {
  billingKey:       string;
  cardCompany:      string;
  cardNumberMasked: string;
};

export type ChargeParams = {
  billingKey:    string;
  customerKey:   string;
  /** 원, 부가세 포함 */
  amount:        number;
  /** 시도마다 고유 (tb_bl_payment.pg_order_id UNIQUE) */
  orderId:       string;
  orderName:     string;
  customerEmail: string;
};

export type ChargeResult =
  | { ok: true;  paymentKey: string; receiptUrl: string | null; approvedAt: Date }
  | { ok: false; code: string; message: string };

/**
 * 주문 ID 로 청구 결과를 확인한 것.
 *   DONE        — 승인됨 (돈이 나갔다). PAID 로 확정할 수 있다
 *   NOT_CHARGED — PG 에 그 주문이 없거나 승인되지 않음. FAILED 로 확정하고 새 시도를 해도 안전
 *   UNKNOWN     — 조회 실패·처리 중. 아무것도 확정하지 말고 나중에 다시
 */
export type ChargeLookup =
  | { status: "DONE"; paymentKey: string; receiptUrl: string | null; approvedAt: Date }
  | { status: "NOT_CHARGED"; reason: string }
  | { status: "UNKNOWN"; reason: string };

export type CancelPaymentParams = {
  paymentKey: string;
  amount:     number;
  reason:     string;
  /** 같은 취소를 재시도해도 한 번만 실행되게 하는 키 (토스 Idempotency-Key). 없으면 호출 1회만 보호 */
  idempotencyKey?: string;
};

export type CancelPaymentResult =
  /** cancelKey — PG 취소 트랜잭션 키 (tb_bl_payment.pg_cancel_key). Mock 은 null */
  | { ok: true; cancelKey: string | null }
  | { ok: false; code: string; message: string };

/** 웹훅 1건 — 저장은 tb_bl_pg_event, 멱등 키는 (provider, providerEventId) */
export type PgEvent = {
  providerEventId: string;
  eventType:       string;
  payload:         unknown;
};

export interface PaymentGateway {
  readonly provider: PgProviderCode;
  startCardRegistration(params: StartCardRegistrationParams): Promise<CardRegistrationStart>;
  /** 실패는 BillingError 로 던진다 (토스 메시지 포함). 호출자는 그대로 사용자에게 보여 준다 */
  issueBillingKey(params: IssueBillingKeyParams): Promise<IssuedBillingKey>;
  /**
   * ok:false 는 "청구되지 않았다"가 확인된 거절이다 — 실패 이력으로 기록해도 안전.
   * 결과를 알 수 없으면(통신 두절 뒤 조회도 실패) BillingError(PAYMENT_STATUS_UNKNOWN) 를 던진다.
   * 호출자는 이 예외를 실패로 기록하면 안 된다(이중 청구 위험) — 그대로 전파하면 결제 작업 토큰이 만료된 뒤 다음 시도가 이어진다.
   */
  charge(params: ChargeParams): Promise<ChargeResult>;
  /** PENDING 시도 복구용 — 주문 ID 로 "청구됐는가"를 PG 에 묻는다. 예외를 던지지 않는다(UNKNOWN 으로 돌려준다) */
  lookupCharge(orderId: string): Promise<ChargeLookup>;
  cancelPayment(params: CancelPaymentParams): Promise<CancelPaymentResult>;
  /** 서명 검증 포함. 검증 실패·형식 불일치면 null */
  parseWebhook(request: Request): Promise<PgEvent | null>;
}

// ─── 구현 선택 ───────────────────────────────────────────────────────────────

let cached: PaymentGateway | null = null;

/**
 * 환경변수로 구현을 고른다. 모듈 로드 시점이 아니라 첫 호출 시 결정 —
 * 테스트·스크립트에서 env 를 바꿔 넣을 수 있도록.
 */
export function getPaymentGateway(): PaymentGateway {
  if (cached) return cached;

  const mode = (process.env.PAYMENT_GATEWAY ?? "mock").toLowerCase();
  if (mode === "mock") {
    cached = new MockPaymentGateway();
    return cached;
  }
  if (mode === "toss") {
    // 생성자가 TOSS_SECRET_KEY·TOSS_CLIENT_KEY 를 검사한다 — 없으면 여기서 던져서 설정 실수를 바로 드러낸다
    cached = new TossPaymentGateway();
    return cached;
  }
  throw new Error(`알 수 없는 PAYMENT_GATEWAY 값입니다: ${mode} (mock | toss)`);
}

/** 프로바이더 코드로 게이트웨이를 고른다 — 웹훅 라우트의 [provider] 세그먼트용 */
export function getPaymentGatewayFor(provider: string): PaymentGateway | null {
  const gw = getPaymentGateway();
  return gw.provider === provider.toUpperCase() ? gw : null;
}

export function isPgProviderCode(v: unknown): v is PgProviderCode {
  return v === PG_PROVIDER.MOCK || v === PG_PROVIDER.TOSS;
}

// ─── 고객 키 ─────────────────────────────────────────────────────────────────

/**
 * 결제 흐름의 서명 비밀 — 회원 UUID 만으로 customerKey·state 를 계산할 수 없게 하는 서버 측 키.
 * 별도 환경변수 없이 API_KEY_SECRET(운영 필수)에서 용도 문자열로 파생한다. 개발 기본값은 encrypt.ts 와 같다.
 * ⚠ 바꾸면 기존 구독의 pg_customer_key 와 어긋나 다음 청구가 NOT_MATCHES_CUSTOMER_KEY 로 실패한다 — 재등록 필요.
 */
function billingSigningSecret(): string {
  return process.env.API_KEY_SECRET ?? "specode-dev-key-do-not-use-in-prod!";
}

/**
 * PG 고객 식별키 — 회원별 고정값.
 *   회원 UUID 를 그대로 PG 에 보내지 않고 **서버 비밀로 HMAC** 한다(2026-09-30, 라이브 전 필수 ⑤).
 *   왜 단순 해시가 아닌가: 회원 UUID 는 멤버 목록 등 여러 API 응답에 나간다. 비밀 없는 해시면 누구나 남의
 *   customerKey 를 계산해 자기 카드를 남의 계정에 붙이는 콜백 링크를 만들 수 있다.
 *   토스 customerKey 규칙: 2~50자, 영문·숫자·-_=.@ — "spc_" + 32 hex = 36자로 만족.
 *   DB 행이 없어도 계산 가능해서 카드 등록 → 콜백 사이에 상태를 저장하지 않아도 된다.
 */
export function buildCustomerKey(mberId: string): string {
  const hex = createHmac("sha256", billingSigningSecret()).update(`specode-customer:${mberId}`).digest("hex");
  return `spc_${hex.slice(0, 32)}`;
}

// ─── 카드 등록 state (CSRF 차단) ──────────────────────────────────────────────

/** 카드 등록 시작 시 서버가 서명해 successUrl/failUrl 에 싣고, 콜백에서 검증하는 값 */
export type CardRegistrationState = {
  mberId:   string;
  purpose:  "start" | "change";
  seatCnt?: number;
  /** 만료 (epoch ms) — 카드 등록창을 열어 둔 채 오래 지난 링크는 거부 */
  exp:      number;
};

/** state 유효 시간 — 카드 입력에 충분하고, 공격자가 링크를 묵혀 두고 쓰기엔 짧게 */
export const CARD_REGISTRATION_STATE_TTL_MS = 30 * 60 * 1000;

function stateSignature(payloadB64: string): string {
  return createHmac("sha256", billingSigningSecret()).update(`card-registration-state:${payloadB64}`).digest("base64url");
}

/**
 * state 발급 — base64url(JSON).서명. URL 쿼리에 그대로 실린다.
 * 왜 서버 저장이 아닌 서명인가: DB 컬럼·정리 배치 없이 무상태로 검증할 수 있고, 값 자체에 비밀이 없다(회원 ID 는 이미 공개 값).
 */
export function issueCardRegistrationState(p: Omit<CardRegistrationState, "exp">, now = new Date()): string {
  const payload: CardRegistrationState = { ...p, exp: now.getTime() + CARD_REGISTRATION_STATE_TTL_MS };
  const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${b64}.${stateSignature(b64)}`;
}

/** state 검증 — 서명·만료·본인 여부. 실패하면 null (호출자가 403) */
export function verifyCardRegistrationState(token: string, mberId: string, now = new Date()): CardRegistrationState | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = stateSignature(b64);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let parsed: CardRegistrationState;
  try {
    parsed = JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (parsed.mberId !== mberId) return null;
  if (typeof parsed.exp !== "number" || parsed.exp < now.getTime()) return null;
  if (parsed.purpose !== "start" && parsed.purpose !== "change") return null;
  return parsed;
}
