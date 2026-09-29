/**
 * billing/gateway-toss — 토스페이먼츠 빌링(자동결제) 어댑터 (PAYMENT_GATEWAY=toss)
 *
 * 역할:
 *   - 카드 등록: 브라우저 SDK(requestBillingAuth)가 창을 띄우므로 서버는 clientKey·customerKey·
 *     successUrl·failUrl 만 돌려준다 (mode:"sdk"). 토스가 successUrl 에 authKey·customerKey 를 붙여 돌려보낸다.
 *   - 빌링키 발급: POST /v1/billing/authorizations/issue (authKey 1회용)
 *   - 청구:        POST /v1/billing/{billingKey} — Idempotency-Key = orderId
 *   - 취소:        POST /v1/payments/{paymentKey}/cancel
 *   - 웹훅:        토스 빌링 웹훅에는 서명이 없다 → 본문의 paymentKey 로 결제 조회 API 를 다시 불러
 *                  "토스가 돌려준 값"만 payload 로 쓴다(본문은 신뢰하지 않는다).
 *
 * 인증: Authorization: Basic base64(secretKey + ":")  (docs.tosspayments.com/reference/using-api/authorization)
 * env : TOSS_SECRET_KEY(test_sk_/live_sk_), TOSS_CLIENT_KEY(test_ck_/live_ck_) — 둘 다 "API 개별 연동 키"
 *
 * 결과를 알 수 없는 청구 (정책 §7-3 7번 "UNKNOWN 복구"):
 *   타임아웃·연결 끊김이면 돈이 나갔는지 모른다. 순서대로 ① 같은 Idempotency-Key 로 1회 재요청(토스가 첫 요청을
 *   처리했으면 같은 결과, 아니면 새로 처리) ② 그래도 모르면 주문번호 조회(GET /v1/payments/orders/{orderId})
 *   ③ 조회도 안 되면 BillingError(PAYMENT_STATUS_UNKNOWN) 를 던진다. 호출자는 이 예외를 "실패"로 기록하면 안 된다
 *   (실패로 세면 다음 시도에서 이중 청구). 결제 작업 토큰이 2분 뒤 만료되면 다음 배치가 다시 시도한다.
 *
 * 테스트: 시크릿 키가 test_ 로 시작할 때만 env TOSS_TEST_ERROR_CODE 를 TossPayments-Test-Code 헤더로 보내
 *   거절(REJECT_CARD_PAYMENT 등)을 재현한다(스모크 scripts/billing-toss-smoke.ts). 라이브 키에서는 무시된다.
 */

import { createHash, randomUUID } from "node:crypto";
import { BILLING_ERROR_CODES as E, PG_PROVIDER } from "./constants";
import { BillingError } from "./errors";
import type {
  CancelPaymentParams,
  CancelPaymentResult,
  CardRegistrationStart,
  ChargeLookup,
  ChargeParams,
  ChargeResult,
  IssueBillingKeyParams,
  IssuedBillingKey,
  PaymentGateway,
  PgEvent,
  StartCardRegistrationParams,
} from "./gateway";

// ─── 상수 ────────────────────────────────────────────────────────────────────

const TOSS_API_BASE = "https://api.tosspayments.com";

/** 토스 빌링 승인은 최대 60초까지 걸릴 수 있다(문서). 그보다 길게 기다린 뒤 결과 조회로 넘어간다 */
const REQUEST_TIMEOUT_MS = 65_000;

/** 웹훅 본문 상한 — 서명이 없어 아무나 보낼 수 있으므로 큰 본문은 읽지 않는다 */
const WEBHOOK_MAX_BODY_BYTES = 64 * 1024;

/** 토스 웹훅 이벤트 종류 (docs.tosspayments.com/reference/using-api/webhook-events) */
export const TOSS_WEBHOOK_EVENT = {
  PAYMENT_STATUS_CHANGED: "PAYMENT_STATUS_CHANGED",
  CANCEL_STATUS_CHANGED:  "CANCEL_STATUS_CHANGED",
  BILLING_DELETED:        "BILLING_DELETED",
} as const;

/** 토스 Payment.status 값 */
export const TOSS_PAYMENT_STATUS = {
  READY:            "READY",
  IN_PROGRESS:      "IN_PROGRESS",
  DONE:             "DONE",
  CANCELED:         "CANCELED",
  PARTIAL_CANCELED: "PARTIAL_CANCELED",
  ABORTED:          "ABORTED",
  EXPIRED:          "EXPIRED",
} as const;

/**
 * 카드 발급사 코드 → 표시명 (docs.tosspayments.com/codes/org-codes 카드사 코드).
 * 2024-06-01 API 버전부터 응답에 cardCompany 가 없고 card.issuerCode 만 온다.
 * 표에 없는 코드(테스트 환경의 "4V" 등)는 코드 그대로 표시한다.
 */
const CARD_ISSUER_NAMES: Record<string, string> = {
  "3K": "기업BC", "46": "광주은행", "71": "롯데카드", "30": "산업은행", "31": "BC카드", "51": "삼성카드",
  "38": "새마을금고", "41": "신한카드", "62": "신협", "36": "씨티카드", "33": "우리카드", "W1": "우리카드",
  "37": "우체국", "39": "저축은행", "35": "전북은행", "42": "제주은행", "15": "카카오뱅크", "3A": "케이뱅크",
  "24": "토스뱅크", "21": "하나카드", "61": "현대카드", "11": "KB국민카드", "91": "NH농협카드", "34": "수협은행",
};

// ─── 토스 응답 타입 (쓰는 필드만) ────────────────────────────────────────────

type TossCard = {
  issuerCode?: string | null;
  /** 마스킹된 카드번호 예: "43301234****123*" */
  number?:     string | null;
};

type TossBilling = {
  billingKey:  string;
  customerKey: string;
  card?:       TossCard | null;
};

export type TossCancel = {
  transactionKey: string;
  cancelAmount:   number;
  cancelReason:   string;
  canceledAt:     string;
  cancelStatus?:  string | null;
};

export type TossPayment = {
  mId?:         string;
  paymentKey:   string;
  orderId:      string;
  status:       string;
  totalAmount:  number;
  /** 취소 후 남은 금액 — 전액 취소면 0 */
  balanceAmount?: number;
  approvedAt?:  string | null;
  receipt?:     { url: string } | null;
  cancels?:     TossCancel[] | null;
  card?:        TossCard | null;
};

/** parseWebhook 이 저장하는 payload 모양 — webhook.ts 가 읽는다 */
export type TossWebhookPayload =
  | { verified: true;  eventType: string; createdAt: string; payment: TossPayment }
  | { verified: false; eventType: string; createdAt: string; data: unknown };

type TossResult<T> =
  | { ok: true;  status: number; data: T }
  | { ok: false; status: number; code: string; message: string };

/** 네트워크·타임아웃·응답 파싱 실패 — 토스가 요청을 처리했는지 알 수 없는 상태 */
class TossTransportError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "TossTransportError";
  }
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(`${name} 환경변수가 설정되지 않았습니다. PAYMENT_GATEWAY=toss 에는 TOSS_SECRET_KEY·TOSS_CLIENT_KEY 가 필요합니다.`);
  }
  return v;
}

export function cardIssuerName(issuerCode: string | null | undefined): string {
  if (!issuerCode) return "카드";
  return CARD_ISSUER_NAMES[issuerCode] ?? issuerCode;
}

/** "43301234****123*" → "4330-1234-****-123*" (4자리 묶음). 길이가 애매하면 그대로 */
export function formatMaskedCardNumber(raw: string | null | undefined): string {
  if (!raw) return "";
  const compact = raw.replace(/[^0-9*]/g, "");
  if (compact.length < 13 || compact.length > 19) return raw;
  return compact.match(/.{1,4}/g)?.join("-") ?? raw;
}

/** `/v1/billing/{billingKey}` 의 빌링키를 가린다 — 예외 메시지·로그용. 발급·조회 경로는 그대로 */
export function maskBillingKeyInPath(path: string): string {
  return path.replace(/^\/v1\/billing\/(?!authorizations\/)[^/?]+/, "/v1/billing/{billingKey}");
}

/** 웹훅 이벤트 ID — 토스는 이벤트 ID 를 주지 않아 (종류·발생시각·대상·상태) 해시로 만든다. 재전송은 같은 값 */
function webhookEventId(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function unknownResultError(orderId: string, cause: unknown): BillingError {
  console.error(`[billing/toss] 청구 결과 확인 불가 — orderId=${orderId} 토스 콘솔과 대조 필요`, cause);
  return new BillingError(
    E.PAYMENT_STATUS_UNKNOWN,
    "결제 서버 응답을 확인하지 못했습니다. 결제가 이루어졌는지 확인 중이니 잠시 후 구독 화면을 새로 고쳐 주세요.",
    503,
    { orderId },
  );
}

// ─── 어댑터 ──────────────────────────────────────────────────────────────────

export class TossPaymentGateway implements PaymentGateway {
  readonly provider = PG_PROVIDER.TOSS;

  private readonly secretKey: string;
  private readonly clientKey: string;

  constructor() {
    this.secretKey = requireEnv("TOSS_SECRET_KEY");
    this.clientKey = requireEnv("TOSS_CLIENT_KEY");
  }

  /** 테스트 키인가 — TossPayments-Test-Code 헤더는 테스트 키에서만 동작 */
  get isTestMode(): boolean {
    return this.secretKey.startsWith("test_");
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    opts: { body?: Record<string, unknown>; idempotencyKey?: string } = {},
  ): Promise<TossResult<T>> {
    // 오류 메시지·로그에는 빌링키가 든 경로를 절대 그대로 쓰지 않는다 (Vercel 로그에 남으면 유출)
    const safePath = maskBillingKeyInPath(path);
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString("base64")}`,
      "Content-Type": "application/json",
    };
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    // 거절 재현(테스트 키 전용) — 스모크·수동 점검에서 env 로 켠다
    const testCode = process.env.TOSS_TEST_ERROR_CODE?.trim();
    if (testCode && this.isTestMode && method === "POST") headers["TossPayments-Test-Code"] = testCode;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    let text: string;
    try {
      res  = await fetch(`${TOSS_API_BASE}${path}`, {
        method, headers, signal: controller.signal,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      text = await res.text();
    } catch (err) {
      throw new TossTransportError(`토스 API 호출 실패: ${method} ${safePath}`, err);
    } finally {
      clearTimeout(timer);
    }

    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (err) {
        throw new TossTransportError(`토스 API 응답 파싱 실패: ${method} ${safePath} (HTTP ${res.status})`, err);
      }
    }
    if (!res.ok) {
      const e = (json ?? {}) as { code?: string; message?: string };
      return { ok: false, status: res.status, code: e.code ?? `HTTP_${res.status}`, message: e.message ?? res.statusText };
    }
    return { ok: true, status: res.status, data: json as T };
  }

  // ── 카드 등록 ─────────────────────────────────────────────────────────────

  async startCardRegistration(p: StartCardRegistrationParams): Promise<CardRegistrationStart> {
    return { mode: "sdk", clientKey: this.clientKey, customerKey: p.customerKey, successUrl: p.successUrl, failUrl: p.failUrl };
  }

  async issueBillingKey(p: IssueBillingKeyParams): Promise<IssuedBillingKey> {
    let r: TossResult<TossBilling>;
    try {
      r = await this.request<TossBilling>("POST", "/v1/billing/authorizations/issue", {
        body: { authKey: p.authKey, customerKey: p.customerKey },
      });
    } catch (err) {
      console.error("[billing/toss] 빌링키 발급 통신 실패:", err);
      throw new BillingError(E.GATEWAY_UNAVAILABLE, "결제 서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.", 502);
    }
    if (!r.ok) {
      // authKey 만료·재사용, 카드사 거절 등 — 토스 메시지를 그대로 보여 주는 편이 사용자가 조치하기 쉽다
      throw new BillingError(E.GATEWAY_UNAVAILABLE, `카드 등록에 실패했습니다. ${r.message}`, 502, { pgCode: r.code });
    }
    return {
      billingKey:       r.data.billingKey,
      cardCompany:      cardIssuerName(r.data.card?.issuerCode),
      cardNumberMasked: formatMaskedCardNumber(r.data.card?.number),
    };
  }

  // ── 청구 ──────────────────────────────────────────────────────────────────

  async charge(p: ChargeParams): Promise<ChargeResult> {
    const path = `/v1/billing/${encodeURIComponent(p.billingKey)}`;
    const opts = {
      body: {
        customerKey:   p.customerKey,
        amount:        p.amount,
        orderId:       p.orderId,
        orderName:     p.orderName,
        customerEmail: p.customerEmail,
      },
      // 시도 1건 = 주문 ID 1개 = 멱등키 1개. 같은 키로 다시 보내면 토스가 첫 결과를 돌려준다(15일)
      idempotencyKey: p.orderId,
    };

    let r: TossResult<TossPayment>;
    try {
      r = await this.request<TossPayment>("POST", path, opts);
    } catch (first) {
      console.warn(`[billing/toss] 청구 통신 실패 — 같은 멱등키로 1회 재요청 orderId=${p.orderId}`, first);
      try {
        r = await this.request<TossPayment>("POST", path, opts);
      } catch (second) {
        return this.recoverChargeByLookup(p.orderId, second);
      }
    }

    if (!r.ok) {
      // 첫 요청이 토스 쪽에서 아직 처리 중 — 결과는 조회로 확인
      if (r.code === "IDEMPOTENT_REQUEST_PROCESSING") return this.recoverChargeByLookup(p.orderId, r);
      return { ok: false, code: r.code, message: r.message };
    }
    return toChargeResult(r.data);
  }

  /**
   * 청구 결과를 주문번호로 확인한다 (charge 안의 즉시 복구).
   *   DONE        → 성공으로 취급 (돈이 나갔다)
   *   NOT_CHARGED → 청구되지 않음 → 실패로 기록해도 안전
   *   UNKNOWN     → PAYMENT_STATUS_UNKNOWN 예외 — 호출자는 실패로 기록하지 말 것(PENDING 행이 남아 배치가 다시 조회)
   */
  private async recoverChargeByLookup(orderId: string, cause: unknown): Promise<ChargeResult> {
    const look = await this.lookupCharge(orderId);
    if (look.status === "DONE") return { ok: true, paymentKey: look.paymentKey, receiptUrl: look.receiptUrl, approvedAt: look.approvedAt };
    if (look.status === "NOT_CHARGED") return { ok: false, code: "PG_UNREACHABLE", message: "결제 서버와 통신하지 못해 청구되지 않았습니다. 잠시 후 다시 시도해 주세요." };
    throw unknownResultError(orderId, { reason: look.reason, cause });
  }

  /**
   * 주문 ID 로 결제 조회 — GET /v1/payments/orders/{orderId}
   *   DONE                       → DONE
   *   404 / ABORTED / EXPIRED    → NOT_CHARGED (토스에 주문이 없거나 승인되지 않음)
   *   통신 실패 / 그 외 상태(IN_PROGRESS 등) / 취소됨(CANCELED — 승인은 됐었다) → UNKNOWN 으로 두고 사람이 본다
   */
  async lookupCharge(orderId: string): Promise<ChargeLookup> {
    let r: TossResult<TossPayment>;
    try {
      r = await this.request<TossPayment>("GET", `/v1/payments/orders/${encodeURIComponent(orderId)}`);
    } catch (err) {
      return { status: "UNKNOWN", reason: `조회 통신 실패: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!r.ok) {
      if (r.status === 404) return { status: "NOT_CHARGED", reason: "토스에 해당 주문 없음(요청이 도달하지 않음)" };
      return { status: "UNKNOWN", reason: `조회 오류 ${r.code}: ${r.message}` };
    }
    const status = r.data.status;
    if (status === TOSS_PAYMENT_STATUS.DONE) {
      return { status: "DONE", paymentKey: r.data.paymentKey, receiptUrl: r.data.receipt?.url ?? null, approvedAt: r.data.approvedAt ? new Date(r.data.approvedAt) : new Date() };
    }
    if (status === TOSS_PAYMENT_STATUS.ABORTED || status === TOSS_PAYMENT_STATUS.EXPIRED) {
      return { status: "NOT_CHARGED", reason: `토스 상태 ${status}` };
    }
    return { status: "UNKNOWN", reason: `토스 상태 ${status} — 확정 불가` };
  }

  // ── 취소 ──────────────────────────────────────────────────────────────────

  async cancelPayment(p: CancelPaymentParams): Promise<CancelPaymentResult> {
    let r: TossResult<TossPayment>;
    try {
      r = await this.request<TossPayment>("POST", `/v1/payments/${encodeURIComponent(p.paymentKey)}/cancel`, {
        body: { cancelReason: p.reason, cancelAmount: p.amount },
        // 호출자가 키를 주면 재시도해도 한 번만 취소된다. 없으면 이 호출 1회만 보호
        idempotencyKey: p.idempotencyKey ?? randomUUID(),
      });
    } catch (err) {
      console.error(`[billing/toss] 취소 통신 실패 paymentKey=${p.paymentKey}`, err);
      return { ok: false, code: "PG_UNREACHABLE", message: "결제 서버와 통신하지 못했습니다. 토스 콘솔에서 취소 여부를 확인해 주세요." };
    }
    if (!r.ok) return { ok: false, code: r.code, message: r.message };
    const cancels = r.data.cancels ?? [];
    const last = cancels.length > 0 ? cancels[cancels.length - 1] : null;
    return { ok: true, cancelKey: last?.transactionKey ?? null };
  }

  // ── 조회 ──────────────────────────────────────────────────────────────────

  /** 결제 1건 조회 — 없으면 null, 통신·서버 오류는 예외 */
  async lookupPayment(paymentKey: string): Promise<TossPayment | null> {
    const r = await this.request<TossPayment>("GET", `/v1/payments/${encodeURIComponent(paymentKey)}`);
    if (r.ok) return r.data;
    if (r.status === 404) return null;
    throw new Error(`토스 결제 조회 실패: ${r.code} ${r.message}`);
  }

  // ── 웹훅 ──────────────────────────────────────────────────────────────────

  /**
   * 토스 빌링 웹훅에는 서명이 없다(서명 헤더는 지급대행 이벤트에만 있음). 그래서:
   *   PAYMENT_STATUS_CHANGED → 본문의 paymentKey 로 결제를 다시 조회해 그 결과만 payload 로 저장 (verified:true)
   *   BILLING_DELETED        → 검증 수단이 없어 빌링키 끝 4자리만 남기고 기록 (verified:false)
   *   그 외 종류             → 원문 기록만 (verified:false). 처리는 webhook.ts 가 verified 를 보고 결정
   * 형식이 다르거나 조회로 확인되지 않으면 null → 400 (토스가 재전송한다)
   */
  async parseWebhook(request: Request): Promise<PgEvent | null> {
    const raw = await request.text();
    if (!raw || Buffer.byteLength(raw) > WEBHOOK_MAX_BODY_BYTES) return null;
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!body || typeof body !== "object") return null;
    const { eventType, createdAt, data } = body as Record<string, unknown>;
    if (typeof eventType !== "string" || !eventType || typeof createdAt !== "string" || !createdAt) return null;
    if (!data || typeof data !== "object") return null;
    const d = data as Record<string, unknown>;

    if (eventType === TOSS_WEBHOOK_EVENT.PAYMENT_STATUS_CHANGED) {
      const paymentKey = d.paymentKey;
      if (typeof paymentKey !== "string" || !paymentKey || paymentKey.length > 200) return null;
      const payment = await this.lookupPayment(paymentKey);
      if (!payment) return null;
      const payload: TossWebhookPayload = { verified: true, eventType, createdAt, payment };
      return {
        providerEventId: webhookEventId([eventType, createdAt, paymentKey, payment.status]),
        eventType,
        payload,
      };
    }

    if (eventType === TOSS_WEBHOOK_EVENT.BILLING_DELETED) {
      const billingKey = typeof d.billingKey === "string" ? d.billingKey : "";
      if (!billingKey) return null;
      const payload: TossWebhookPayload = {
        verified: false, eventType, createdAt,
        data: { billingKeyLast4: billingKey.slice(-4), reason: typeof d.reason === "string" ? d.reason.slice(0, 200) : null },
      };
      return { providerEventId: webhookEventId([eventType, createdAt, billingKey]), eventType, payload };
    }

    const payload: TossWebhookPayload = { verified: false, eventType, createdAt, data };
    return { providerEventId: webhookEventId([eventType, createdAt, raw]), eventType, payload };
  }
}

/** 토스 Payment → ChargeResult. 동기 빌링 승인은 성공이면 항상 DONE */
function toChargeResult(pay: TossPayment): ChargeResult {
  if (pay.status !== TOSS_PAYMENT_STATUS.DONE) {
    return { ok: false, code: `UNEXPECTED_STATUS_${pay.status}`, message: "결제가 승인되지 않았습니다." };
  }
  return {
    ok:         true,
    paymentKey: pay.paymentKey,
    receiptUrl: pay.receipt?.url ?? null,
    approvedAt: pay.approvedAt ? new Date(pay.approvedAt) : new Date(),
  };
}
