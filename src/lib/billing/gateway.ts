/**
 * billing/gateway — PG(결제 게이트웨이) 인터페이스 + 구현 선택
 *
 * 역할:
 *   - 토스페이먼츠 빌링(자동결제) API 모양에 맞춘 추상 인터페이스
 *   - 구현은 두 개: Mock(gateway-mock.ts, 기본) / Toss(가맹 심사 후 파일 하나 추가)
 *   - 환경변수 PAYMENT_GATEWAY=mock|toss 로 선택. 미설정 = mock
 *
 * 왜 인터페이스 뒤에 두는가:
 *   PG 가 뜨는 지점(카드 등록창·빌링키 발급·청구·취소·웹훅)만 갈아 끼우면 나머지
 *   구독·좌석·잠금·배치 코드가 그대로 돈다. 운영 사용자가 회사 내부 인원뿐인 동안은
 *   운영에서도 Mock 을 쓴다(정책 §3 2단계 원칙).
 *
 * 토스 어댑터 붙일 때 (심사 후):
 *   - src/lib/billing/gateway-toss.ts 에 PaymentGateway 구현
 *   - startCardRegistration → { mode:"sdk", clientKey, customerKey }
 *     (토스 카드 등록은 브라우저 SDK requestBillingAuth 가 띄운다 — 리다이렉트 URL 이 아님)
 *   - issueBillingKey → POST /v1/billing/authorizations/issue
 *   - charge → POST /v1/billing/{billingKey}
 *   - cancelPayment → POST /v1/payments/{paymentKey}/cancel
 *   - parseWebhook → 서명 검증 후 PgEvent
 *   - 빌링키 삭제 API 는 토스에 없다 → 우리 DB 에서 NULL 처리로 끝 (인터페이스에 없음)
 */

import { createHash } from "node:crypto";
import { PG_PROVIDER, type PgProviderCode } from "./constants";
import { MockPaymentGateway } from "./gateway-mock";

// ─── 타입 ────────────────────────────────────────────────────────────────────

/**
 * 카드 등록 시작 결과.
 *   redirect — 서버가 준 URL 로 브라우저를 보낸다 (Mock "PG 창")
 *   sdk      — 브라우저 SDK 가 창을 띄운다 (토스). 프론트 버튼이 mode 로 분기
 */
export type CardRegistrationStart =
  | { mode: "redirect"; url: string }
  | { mode: "sdk"; clientKey: string; customerKey: string };

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

export type CancelPaymentParams = {
  paymentKey: string;
  amount:     number;
  reason:     string;
};

export type CancelPaymentResult =
  | { ok: true }
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
  issueBillingKey(params: IssueBillingKeyParams): Promise<IssuedBillingKey>;
  charge(params: ChargeParams): Promise<ChargeResult>;
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
    // 심사 후 gateway-toss.ts 를 추가하고 여기서 생성한다.
    // 미구현 상태에서 조용히 Mock 으로 떨어지면 운영 설정 실수를 못 알아차리므로 명시적으로 막는다.
    throw new Error(
      "PAYMENT_GATEWAY=toss 는 아직 지원되지 않습니다 (토스 어댑터는 가맹 심사 후 추가). " +
      "PAYMENT_GATEWAY=mock 으로 두거나 비워 두세요."
    );
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
 * PG 고객 식별키 — 회원별 고정값.
 *   회원 UUID 를 그대로 PG 에 보내지 않고 해시한다(우리 식별자 노출 최소화).
 *   토스 customerKey 규칙: 2~50자, 영문·숫자·-_=.@ — "spc_" + 32 hex = 36자로 만족.
 *   DB 행이 없어도 계산 가능해서 카드 등록 → 콜백 사이에 상태를 저장하지 않아도 된다.
 */
export function buildCustomerKey(mberId: string): string {
  const hex = createHash("sha256").update(`specode-customer:${mberId}`).digest("hex");
  return `spc_${hex.slice(0, 32)}`;
}
