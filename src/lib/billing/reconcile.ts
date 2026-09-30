/**
 * billing/reconcile — PG 거래 ↔ 결제 이력 일일 대사 (라이브 전 필수 ③, 2026-09-30)
 *
 * 왜 필요한가:
 *   자동결제(빌링) 승인은 토스가 웹훅을 보내지 않는다. "PG 는 승인했는데 우리 DB 에 없다"는 사고는
 *   PENDING 조회(subscription.ts)가 대부분 잡지만, PENDING 행조차 못 만든 경우(DB 장애 순간)나
 *   콘솔에서 사람이 직접 만든 결제·취소는 PG 쪽 목록을 훑어야만 보인다. 그래서 하루 1회 PG 거래 목록을
 *   가져와 우리 이력과 맞춘다. PG 가 진실이고, 우리 이력에 없는 PG 거래가 경보 대상이다.
 *
 * 기준 (주문번호가 아니라 paymentKey/transactionKey 로 맞춘다 — 거래 목록의 orderId 에는 상점 접두사가 붙어 온다):
 *   승인 거래(DONE)              → pg_pymnt_key 가 같은 결제 행(환불 행 제외)이 있어야 한다
 *   취소 거래(CANCELED/PARTIAL)  → pg_cancel_key 가 같은 REFUND 행이 있어야 한다 (웹훅 대조가 만든다)
 *   불일치는 관리자 알림에 실린다. 자동으로 행을 만들지 않는다 — 어느 구독·좌석·기간인지 PG 는 모른다.
 *
 * 기간: 어제 이 시각 ~ 지금 + 여유 1시간(배치 시각 흔들림). 겹치는 구간은 멱등(읽기만 한다).
 */

import { prisma } from "@/lib/prisma";
import { PAYMENT_TYPE } from "./constants";
import { getPaymentGateway, type PgTransaction } from "./gateway";

/** 대사 창 — 하루 1회 배치가 조금 늦거나 빨라도 빠지는 시간이 없게 25시간 */
export const RECONCILE_WINDOW_MS = 25 * 60 * 60 * 1000;

export type ReconcileResult =
  | { supported: false; reason: string }
  | {
      supported: true;
      checked: number;
      /** PG 승인은 있는데 우리 이력에 없음 — 돈은 들어왔고 반영이 안 된 것 */
      unmatchedApprovals: Array<{ orderId: string; paymentKey: string; amount: number; at: string }>;
      /** PG 취소는 있는데 REFUND 이력에 없음 — 웹훅이 유실됐거나 처리 실패 */
      unmatchedCancels:   Array<{ transactionKey: string; paymentKey: string; amount: number; at: string }>;
    };

function isApproval(t: PgTransaction): boolean {
  return t.status === "DONE";
}
function isCancel(t: PgTransaction): boolean {
  return t.status === "CANCELED" || t.status === "PARTIAL_CANCELED";
}

export async function reconcileTransactions(now = new Date()): Promise<ReconcileResult> {
  const gw = getPaymentGateway();
  const list = await gw.listTransactions(new Date(now.getTime() - RECONCILE_WINDOW_MS), new Date(now.getTime() + 60 * 60 * 1000));
  if (!list.supported) return { supported: false, reason: list.reason };

  const approvals = list.transactions.filter(isApproval);
  const cancels   = list.transactions.filter(isCancel);

  // 한 번에 읽어 메모리에서 맞춘다 — 하루치 거래는 많아야 수백 건
  const paymentKeys = [...new Set(approvals.map((t) => t.paymentKey))];
  const cancelKeys  = [...new Set(cancels.map((t) => t.transactionKey))];
  const [knownPayments, knownRefunds] = await Promise.all([
    paymentKeys.length === 0 ? Promise.resolve([]) : prisma.tbBlPayment.findMany({
      where:  { pg_pymnt_key: { in: paymentKeys }, pymnt_ty_code: { not: PAYMENT_TYPE.REFUND } },
      select: { pg_pymnt_key: true },
    }),
    cancelKeys.length === 0 ? Promise.resolve([]) : prisma.tbBlPayment.findMany({
      where:  { pg_cancel_key: { in: cancelKeys }, pymnt_ty_code: PAYMENT_TYPE.REFUND },
      select: { pg_cancel_key: true },
    }),
  ]);
  const havePayment = new Set(knownPayments.map((r) => r.pg_pymnt_key));
  const haveRefund  = new Set(knownRefunds.map((r) => r.pg_cancel_key));

  const unmatchedApprovals = approvals
    .filter((t) => !havePayment.has(t.paymentKey))
    .map((t) => ({ orderId: t.orderId, paymentKey: t.paymentKey, amount: t.amount, at: t.transactionAt.toISOString() }));
  const unmatchedCancels = cancels
    .filter((t) => !haveRefund.has(t.transactionKey))
    .map((t) => ({ transactionKey: t.transactionKey, paymentKey: t.paymentKey, amount: t.amount, at: t.transactionAt.toISOString() }));

  if (unmatchedApprovals.length > 0 || unmatchedCancels.length > 0) {
    console.error(`[billing/reconcile] 불일치 — 승인 ${unmatchedApprovals.length}건, 취소 ${unmatchedCancels.length}건`, { unmatchedApprovals, unmatchedCancels });
  }
  return { supported: true, checked: list.transactions.length, unmatchedApprovals, unmatchedCancels };
}
