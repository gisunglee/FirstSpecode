/**
 * billing-toss-smoke — 토스 어댑터 스모크 (테스트 키 · DB 없음 · 돈 안 나감)
 *
 * 실행: npm run test:billing:toss   (dotenv -e .env.local -- npx tsx scripts/billing-toss-smoke.ts)
 * 전제: .env.local 에 TOSS_SECRET_KEY(test_sk_…)·TOSS_CLIENT_KEY(test_ck_…) — "API 개별 연동 키"
 *
 * 브라우저 카드 등록창(requestBillingAuth)은 여기서 흉내낼 수 없으므로, 테스트 환경에서만 되는
 * 카드 정보 직접 입력 API(POST /v1/billing/authorizations/card)로 빌링키를 얻어 그 뒤 흐름을 검증한다:
 *   빌링키 발급(실패 케이스) → 청구 → 멱등 재요청(같은 paymentKey) → 거절 재현(TossPayments-Test-Code)
 *   → 조회 → 부분 취소·멱등 취소·잔액 취소 → 웹훅 파싱(조회 검증·중복 ID·가짜 키 거부·본문 상한)
 *   → 빌링키 GCM 암호화(왕복·변조 감지·옛 CBC 호환) → 카드 표시 유틸
 *
 * 토스 테스트 상점에 결제 이력이 남는다(테스트 콘솔에서 보인다). 실제 승인은 일어나지 않는다.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.PAYMENT_GATEWAY = "toss";
delete process.env.TOSS_TEST_ERROR_CODE;

const secretKey = process.env.TOSS_SECRET_KEY ?? "";
if (!secretKey.startsWith("test_sk_")) {
  throw new Error("TOSS_SECRET_KEY 가 테스트 키(test_sk_…)가 아닙니다. 라이브 키로는 스모크를 돌리지 않습니다.");
}

let step = 0;
function log(msg: string) {
  step += 1;
  console.log(`[${String(step).padStart(2, "0")}] ${msg}`);
}

/** 테스트 환경 전용 — 카드 정보로 빌링키 발급(브라우저 창 없이). 라이브에서는 별도 계약이 필요한 API */
async function issueTestBillingKey(customerKey: string): Promise<string> {
  const res = await fetch("https://api.tosspayments.com/v1/billing/authorizations/card", {
    method:  "POST",
    headers: {
      Authorization:  `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      customerKey,
      cardNumber:             "9410112233445566", // 테스트 환경에서 빌링 청구까지 통과하는 BIN(BC, issuerCode 31). 다른 BIN 은 NOT_SUPPORTED_CARD_TYPE
      cardExpirationYear:     "30",
      cardExpirationMonth:    "12",
      customerIdentityNumber: "900101",
      cardPassword:           "12",
    }),
  });
  const json = (await res.json()) as { billingKey?: string; code?: string; message?: string };
  if (!res.ok || !json.billingKey) throw new Error(`테스트 빌링키 발급 실패: ${json.code} ${json.message}`);
  return json.billingKey;
}

async function main() {
  const { getPaymentGateway, buildCustomerKey } = await import("@/lib/billing/gateway");
  const { TossPaymentGateway, formatMaskedCardNumber, cardIssuerName, maskBillingKeyInPath } = await import("@/lib/billing/gateway-toss");
  const { encryptBillingKey, decryptBillingKey, isGcmBillingKey } = await import("@/lib/billing/billing-key");
  const { encryptApiKey } = await import("@/lib/encrypt");
  const { BillingError } = await import("@/lib/billing/errors");
  const { BILLING_ERROR_CODES } = await import("@/lib/billing/constants");

  const gw = getPaymentGateway();
  assert.ok(gw instanceof TossPaymentGateway);
  assert.equal(gw.provider, "TOSS");
  assert.equal(gw.isTestMode, true);
  log("게이트웨이 선택: PAYMENT_GATEWAY=toss → TossPaymentGateway (테스트 모드)");

  // ── 카드 등록 시작 ─────────────────────────────────────────────────────────
  const customerKey = buildCustomerKey(`smoke-${randomBytes(6).toString("hex")}`);
  const start = await gw.startCardRegistration({
    customerKey, successUrl: "http://localhost:3000/settings/billing/callback?purpose=start&seatCnt=1",
    failUrl: "http://localhost:3000/settings/billing/callback?purpose=start&result=fail",
  });
  assert.equal(start.mode, "sdk");
  if (start.mode === "sdk") {
    assert.ok(start.clientKey.startsWith("test_ck_"));
    assert.equal(start.customerKey, customerKey);
    assert.ok(start.successUrl.includes("seatCnt=1") && start.failUrl.includes("result=fail"));
  }
  log("startCardRegistration → mode:sdk + clientKey·customerKey·successUrl·failUrl");

  // ── 빌링키 발급 실패 (가짜 authKey) ────────────────────────────────────────
  await assert.rejects(
    () => gw.issueBillingKey({ authKey: "bogus-auth-key", customerKey }),
    (err: unknown) => err instanceof BillingError && err.code === BILLING_ERROR_CODES.GATEWAY_UNAVAILABLE && typeof err.extra?.pgCode === "string",
  );
  log("issueBillingKey(가짜 authKey) → BillingError(GATEWAY_UNAVAILABLE, pgCode 포함)");

  // ── 테스트 빌링키로 청구 ───────────────────────────────────────────────────
  const billingKey = await issueTestBillingKey(customerKey);
  log("테스트 환경 카드 직접 입력 API 로 빌링키 확보");

  const orderId = `SPC-SMOKE-${Date.now()}-${randomBytes(3).toString("hex").toUpperCase()}`;
  const chargeParams = { billingKey, customerKey, amount: 9_900, orderId, orderName: "SPECODE BASIC 1좌석 (스모크)", customerEmail: "smoke@example.com" };
  const first = await gw.charge(chargeParams);
  assert.equal(first.ok, true, `청구 실패: ${JSON.stringify(first)}`);
  if (!first.ok) return;
  assert.ok(first.paymentKey.length > 0 && first.approvedAt instanceof Date);
  assert.ok(typeof first.receiptUrl === "string" && first.receiptUrl.startsWith("https://"));
  log(`charge 9,900원 → ok · paymentKey=${first.paymentKey.slice(0, 8)}… · receipt URL 있음`);

  // ── 멱등 재요청: 같은 orderId(=Idempotency-Key) → 같은 결제 ────────────────
  const again = await gw.charge(chargeParams);
  assert.equal(again.ok, true);
  if (again.ok) assert.equal(again.paymentKey, first.paymentKey);
  log("같은 orderId 로 재청구 → 같은 paymentKey (Idempotency-Key 동작, 이중 결제 없음)");

  // ── 거절 재현 ──────────────────────────────────────────────────────────────
  process.env.TOSS_TEST_ERROR_CODE = "REJECT_CARD_PAYMENT";
  const rejected = await gw.charge({ ...chargeParams, orderId: `${orderId}-R` });
  delete process.env.TOSS_TEST_ERROR_CODE;
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.code, "REJECT_CARD_PAYMENT");
  log("TossPayments-Test-Code=REJECT_CARD_PAYMENT → ok:false, code 그대로 (재시도·PAST_DUE 경로 입력값)");

  // ── 잘못된 빌링키 ──────────────────────────────────────────────────────────
  const badKey = await gw.charge({ ...chargeParams, billingKey: "bogus-billing-key", orderId: `${orderId}-B` });
  assert.equal(badKey.ok, false);
  log(`잘못된 빌링키 청구 → ok:false (${badKey.ok ? "" : badKey.code})`);

  // ── 조회 ───────────────────────────────────────────────────────────────────
  const looked = await gw.lookupPayment(first.paymentKey);
  assert.ok(looked && looked.status === "DONE" && looked.orderId === orderId && looked.totalAmount === 9_900);
  assert.equal(await gw.lookupPayment("nonexistent-payment-key"), null);
  log("lookupPayment → DONE·orderId·금액 일치 / 없는 키 → null");

  // ── 주문 ID 조회 (PENDING 복구용, ①) ──────────────────────────────────────
  const lookDone = await gw.lookupCharge(orderId);
  assert.equal(lookDone.status, "DONE");
  if (lookDone.status === "DONE") assert.equal(lookDone.paymentKey, first.paymentKey);
  const lookNone = await gw.lookupCharge(`SPC-NEVER-${Date.now()}`);
  assert.equal(lookNone.status, "NOT_CHARGED");
  const lookRejected = await gw.lookupCharge(`${orderId}-R`);
  assert.ok(lookRejected.status === "NOT_CHARGED" || lookRejected.status === "UNKNOWN", `거절된 주문 조회: ${JSON.stringify(lookRejected)}`);
  log(`lookupCharge → 승인 주문 DONE(같은 paymentKey) / 없는 주문 NOT_CHARGED / 거절 주문 ${lookRejected.status}`);

  // ── 취소: 부분 → 같은 멱등키 재시도 → 잔액 ─────────────────────────────────
  const idem = `smoke-cancel-${orderId}`;
  const partial = await gw.cancelPayment({ paymentKey: first.paymentKey, amount: 1_000, reason: "스모크 부분 취소", idempotencyKey: idem });
  assert.equal(partial.ok, true, `부분 취소 실패: ${JSON.stringify(partial)}`);
  if (!partial.ok) return;
  assert.ok(typeof partial.cancelKey === "string" && partial.cancelKey.length > 0);
  const partialAgain = await gw.cancelPayment({ paymentKey: first.paymentKey, amount: 1_000, reason: "스모크 부분 취소", idempotencyKey: idem });
  assert.equal(partialAgain.ok, true);
  if (partialAgain.ok) assert.equal(partialAgain.cancelKey, partial.cancelKey);
  const afterPartial = await gw.lookupPayment(first.paymentKey);
  assert.equal(afterPartial?.status, "PARTIAL_CANCELED");
  assert.equal(afterPartial?.cancels?.length, 1);
  log("cancelPayment 1,000원 → cancelKey / 같은 멱등키 재시도 → 같은 cancelKey, 취소 1건 유지 (PARTIAL_CANCELED)");

  const rest = await gw.cancelPayment({ paymentKey: first.paymentKey, amount: 8_900, reason: "스모크 잔액 취소" });
  assert.equal(rest.ok, true, `잔액 취소 실패: ${JSON.stringify(rest)}`);
  const afterFull = await gw.lookupPayment(first.paymentKey);
  // 테스트 상점은 부분 취소 누적으로 잔액이 0 이 되어도 PARTIAL_CANCELED 로 남길 수 있다 → 잔액과 취소 건수로 판정
  assert.ok(afterFull && (afterFull.status === "CANCELED" || afterFull.status === "PARTIAL_CANCELED"));
  assert.equal(afterFull?.balanceAmount, 0);
  assert.equal(afterFull?.cancels?.length, 2);
  log(`잔액 8,900원 취소 → ${afterFull?.status}, balanceAmount 0, cancels 2건`);

  // ── 웹훅 파싱 (서명 없음 → 결제 조회로 검증) ───────────────────────────────
  const createdAt = new Date().toISOString();
  const webhookReq = () => new Request("http://localhost/api/billing/webhook/toss", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventType: "PAYMENT_STATUS_CHANGED", createdAt, data: { paymentKey: first.paymentKey, status: "DONE", totalAmount: 1 } }),
  });
  const ev1 = await gw.parseWebhook(webhookReq());
  assert.ok(ev1 && ev1.eventType === "PAYMENT_STATUS_CHANGED");
  const payload = ev1!.payload as { verified: boolean; payment: { status: string; totalAmount: number; cancels: unknown[] } };
  // 본문이 "DONE·1원"이라고 거짓말해도 payload 는 토스 조회 결과(CANCELED·9,900원)여야 한다
  assert.equal(payload.verified, true);
  assert.ok(payload.payment.status === "CANCELED" || payload.payment.status === "PARTIAL_CANCELED");
  assert.equal(payload.payment.totalAmount, 9_900);
  assert.equal(payload.payment.cancels.length, 2);
  const ev2 = await gw.parseWebhook(webhookReq());
  assert.equal(ev2?.providerEventId, ev1!.providerEventId);
  // 토스가 주는 transmission-id 헤더가 있으면 그것이 이벤트 ID (재전송도 같은 값)
  const withId = await gw.parseWebhook(new Request("http://localhost/x", {
    method: "POST", headers: { "Content-Type": "application/json", "tosspayments-webhook-transmission-id": "tx-smoke-0001" },
    body: JSON.stringify({ eventType: "PAYMENT_STATUS_CHANGED", createdAt, data: { paymentKey: first.paymentKey } }),
  }));
  assert.equal(withId?.providerEventId, "tx-smoke-0001");
  const unknownType = await gw.parseWebhook(new Request("http://localhost/x", {
    method: "POST", body: JSON.stringify({ eventType: "DEPOSIT_CALLBACK", createdAt, data: { secret: "x".repeat(1000) } }),
  }));
  assert.ok(unknownType && (unknownType.payload as { ignored?: true }).ignored === true, "구독하지 않은 종류는 저장 안 함 표식");
  assert.ok(!JSON.stringify(unknownType!.payload).includes("xxxx"), "본문을 담지 않는다");
  log("parseWebhook(PAYMENT_STATUS_CHANGED) → 본문 무시·조회 결과 저장(verified) / 재전송·transmission-id 같은 ID / 모르는 종류는 ignored");

  const fake = await gw.parseWebhook(new Request("http://localhost/x", {
    method: "POST", body: JSON.stringify({ eventType: "PAYMENT_STATUS_CHANGED", createdAt, data: { paymentKey: "no-such-key" } }),
  }));
  assert.equal(fake, null);
  const huge = await gw.parseWebhook(new Request("http://localhost/x", { method: "POST", body: "x".repeat(70 * 1024) }));
  assert.equal(huge, null);
  const malformed = await gw.parseWebhook(new Request("http://localhost/x", { method: "POST", body: "{not json" }));
  assert.equal(malformed, null);
  log("가짜 paymentKey · 64KB 초과 · JSON 아님 → null (400)");

  const deleted = await gw.parseWebhook(new Request("http://localhost/x", {
    method: "POST", body: JSON.stringify({ eventType: "BILLING_DELETED", createdAt, data: { billingKey: billingKey, reason: "스모크" } }),
  }));
  const delPayload = deleted?.payload as { verified: boolean; data: { billingKeyLast4: string } };
  assert.equal(delPayload.verified, false);
  assert.equal(delPayload.data.billingKeyLast4, billingKey.slice(-4));
  assert.ok(!JSON.stringify(deleted).includes(billingKey));
  log("parseWebhook(BILLING_DELETED) → 검증 불가 표시, 빌링키는 끝 4자리만 기록");

  // ── 빌링키 암호화 (AES-256-GCM v2 + 옛 CBC 호환) ───────────────────────────
  const enc = encryptBillingKey(billingKey);
  assert.ok(isGcmBillingKey(enc) && enc.split(":").length === 4);
  assert.equal(decryptBillingKey(enc), billingKey);
  const [v, iv, tag, ct] = enc.split(":");
  const flipped = (ct[0] === "0" ? "1" : "0") + ct.slice(1);
  assert.throws(() => decryptBillingKey(`${v}:${iv}:${tag}:${flipped}`));
  assert.equal(decryptBillingKey(encryptApiKey(billingKey)), billingKey);
  log("빌링키 암호화: v2 GCM 왕복 · 암호문 1바이트 변조 → 복호화 예외 · 옛 CBC 형식 복호화 호환");

  // ── 표시 유틸 ──────────────────────────────────────────────────────────────
  assert.equal(formatMaskedCardNumber("43301234****123*"), "4330-1234-****-123*");
  assert.equal(formatMaskedCardNumber(null), "");
  assert.equal(cardIssuerName("11"), "KB국민카드");
  assert.equal(cardIssuerName("4V"), "4V");
  assert.equal(cardIssuerName(null), "카드");
  log("카드번호 4자리 묶음 · 발급사 코드 → 이름(미등록 코드는 그대로)");

  // ── 오류 메시지 빌링키 마스킹 (⑦, 2026-09-30) ─────────────────────────────
  assert.equal(maskBillingKeyInPath(`/v1/billing/${billingKey}`), "/v1/billing/{billingKey}");
  assert.equal(maskBillingKeyInPath("/v1/billing/authorizations/issue"), "/v1/billing/authorizations/issue");
  assert.equal(maskBillingKeyInPath("/v1/payments/orders/SPC-1"), "/v1/payments/orders/SPC-1");
  log("청구 경로의 빌링키는 예외 메시지에서 {billingKey} 로 가려진다");

  console.log(`\n✅ 토스 어댑터 스모크 ${step}단계 통과`);
}

main().catch((err) => {
  console.error("\n❌ 스모크 실패:", err);
  process.exit(1);
});
