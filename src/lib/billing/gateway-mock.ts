/**
 * billing/gateway-mock — PG 흉내 구현 (PAYMENT_GATEWAY=mock, 기본값)
 *
 * 역할:
 *   - 카드 등록: 앱 안의 "PG 창" 페이지(/billing/pg-window)로 리다이렉트. 사용자가 카드사·끝 4자리를
 *     입력하고 [성공]/[실패] 를 누르면 successUrl / failUrl 로 돌아온다.
 *   - 빌링키 발급: authKey 안에 담긴 카드 정보로 빌링키를 만든다.
 *     "결제 실패 카드" 로 등록하면 빌링키에 "fail" 이 들어가고, 이 키로 하는 청구는 항상 거절된다
 *     → 결제 실패·재시도·강등 흐름을 실제 배치로 시험할 수 있다.
 *   - 청구: 즉시 승인. 영수증 URL 은 PG 창의 영수증 뷰.
 *   - 웹훅: 헤더 X-Mock-Signature 가 env MOCK_WEBHOOK_SECRET 과 같을 때만 수락 (없으면 전부 거부).
 *
 * 돈이 오가지 않는다. 운영에서도 내부 사용자만 쓰는 동안은 이 구현을 사용한다(정책 §3).
 */

import { randomBytes } from "node:crypto";
import { MOCK_PG_WINDOW_PATH, PG_PROVIDER } from "./constants";
import { decodeMockAuthKey } from "./mock-auth-key";
import type {
  CancelPaymentParams,
  CancelPaymentResult,
  CardRegistrationStart,
  ChargeParams,
  ChargeResult,
  IssueBillingKeyParams,
  IssuedBillingKey,
  PaymentGateway,
  PgEvent,
  StartCardRegistrationParams,
} from "./gateway";

// authKey 인코딩은 PG 창(클라이언트)과 공유 — mock-auth-key.ts
export { encodeMockAuthKey, type MockAuthPayload } from "./mock-auth-key";

export class MockPaymentGateway implements PaymentGateway {
  readonly provider = PG_PROVIDER.MOCK;

  async startCardRegistration(p: StartCardRegistrationParams): Promise<CardRegistrationStart> {
    const qs = new URLSearchParams({
      customerKey: p.customerKey,
      successUrl:  p.successUrl,
      failUrl:     p.failUrl,
    });
    return { mode: "redirect", url: `${MOCK_PG_WINDOW_PATH}?${qs.toString()}` };
  }

  async issueBillingKey(p: IssueBillingKeyParams): Promise<IssuedBillingKey> {
    const card = decodeMockAuthKey(p.authKey);
    if (!card) {
      throw new Error("유효하지 않은 Mock authKey 입니다.");
    }
    // 빌링키에 customerKey 일부를 섞어 두면 어느 고객의 키인지 로그에서 추적하기 쉽다.
    // "fail" 토큰은 charge() 가 실패를 흉내내는 신호.
    const tag = card.alwaysFail ? "fail_" : "";
    const billingKey = `mockbk_${tag}${p.customerKey.slice(-8)}_${randomBytes(8).toString("hex")}`;
    return {
      billingKey,
      cardCompany:      card.cardCompany,
      cardNumberMasked: `****-****-****-${card.last4}`,
    };
  }

  async charge(p: ChargeParams): Promise<ChargeResult> {
    if (p.billingKey.includes("fail")) {
      return { ok: false, code: "MOCK_DECLINED", message: "모의 결제 거절 — 실패 테스트 카드입니다." };
    }
    const approvedAt = new Date();
    const paymentKey = `mockpay_${randomBytes(10).toString("hex")}`;
    const receipt = new URLSearchParams({
      view:       "receipt",
      orderId:    p.orderId,
      orderName:  p.orderName,
      amount:     String(p.amount),
      approvedAt: approvedAt.toISOString(),
      paymentKey,
    });
    return {
      ok: true,
      paymentKey,
      receiptUrl: `${MOCK_PG_WINDOW_PATH}?${receipt.toString()}`,
      approvedAt,
    };
  }

  async cancelPayment(_p: CancelPaymentParams): Promise<CancelPaymentResult> {
    return { ok: true };
  }

  async parseWebhook(request: Request): Promise<PgEvent | null> {
    const secret = process.env.MOCK_WEBHOOK_SECRET;
    // 시크릿이 없으면 웹훅 경로를 닫는다 — 아무나 이벤트 행을 쌓지 못하게.
    if (!secret || request.headers.get("x-mock-signature") !== secret) return null;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return null;
    }
    if (!body || typeof body !== "object") return null;
    const { eventId, eventType, data } = body as Record<string, unknown>;
    if (typeof eventId !== "string" || !eventId || typeof eventType !== "string" || !eventType) return null;
    return { providerEventId: eventId, eventType, payload: data ?? {} };
  }
}
