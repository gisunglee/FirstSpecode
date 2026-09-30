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
 * 기간(워터마크): 마지막으로 성공한 일일 배치 시작 시각 − 1시간 부터 지금 + 1시간 까지. cron 이 며칠 빠져도 그 구간이
 *   통째로 대사에서 빠지지 않는다. 기록이 없거나 너무 오래됐으면 최대 31일. 최소 25시간. 겹치는 구간은 멱등(읽기만 한다).
 * 비교: 키 존재 + **금액** (같은 키인데 금액이 다르면 불일치). 상태·PG 는 웹훅 대조가 본다.
 */

import { prisma } from "@/lib/prisma";
import { PAYMENT_TYPE } from "./constants";
import { BILLING_DAILY_JOB_TYPE } from "./daily";
import { getPaymentGateway, type PgTransaction } from "./gateway";

/** 대사 창 최소 — 하루 1회 배치가 조금 늦거나 빨라도 빠지는 시간이 없게 25시간 */
export const RECONCILE_WINDOW_MS = 25 * 60 * 60 * 1000;
/** 대사 창 최대 — 토스 거래 조회 부하와 5000건 페이지를 감안한 상한 */
export const RECONCILE_MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

/** 마지막으로 완료(SUCCESS/PARTIAL)된 일일 배치 시작 시각 — 없으면 null */
async function lastCompletedDailyRunAt(): Promise<Date | null> {
  const row = await prisma.tbCmBatchJob.findFirst({
    where:   { job_ty_code: BILLING_DAILY_JOB_TYPE, sttus_code: { in: ["SUCCESS", "PARTIAL"] } },
    orderBy: { bgng_dt: "desc" },
    select:  { bgng_dt: true },
  });
  return row?.bgng_dt ?? null;
}

/** 대사 시작 시각 — 워터마크 기반. export 는 스모크용 */
export async function reconcileWindowStart(now: Date): Promise<Date> {
  const last = await lastCompletedDailyRunAt();
  const floor = new Date(now.getTime() - RECONCILE_WINDOW_MS);
  const cap   = new Date(now.getTime() - RECONCILE_MAX_WINDOW_MS);
  if (!last) return floor;
  const fromLast = new Date(last.getTime() - 60 * 60 * 1000);
  const start = fromLast < floor ? fromLast : floor;   // 더 이른 쪽
  return start < cap ? cap : start;                    // 단, 31일 이내
}

export type ReconcileResult =
  | { supported: false; reason: string }
  | {
      supported: true;
      checked: number;
      /** PG 승인은 있는데 우리 이력에 없음 — 돈은 들어왔고 반영이 안 된 것 */
      unmatchedApprovals: Array<{ orderId: string; paymentKey: string; amount: number; at: string }>;
      /** PG 취소는 있는데 REFUND 이력에 없음 — 웹훅이 유실됐거나 처리 실패 */
      unmatchedCancels:   Array<{ transactionKey: string; paymentKey: string; amount: number; at: string }>;
      /** 키는 맞는데 금액이 다름 — 이력은 있지만 내용이 틀린 것 */
      amountMismatches:   Array<{ key: string; kind: "approval" | "cancel"; pgAmount: number; ourAmount: number }>;
      windowStart:        string;
    };

function isApproval(t: PgTransaction): boolean {
  return t.status === "DONE";
}
function isCancel(t: PgTransaction): boolean {
  return t.status === "CANCELED" || t.status === "PARTIAL_CANCELED";
}

export async function reconcileTransactions(now = new Date()): Promise<ReconcileResult> {
  const gw = getPaymentGateway();
  const windowStart = await reconcileWindowStart(now);
  const list = await gw.listTransactions(windowStart, new Date(now.getTime() + 60 * 60 * 1000));
  if (!list.supported) return { supported: false, reason: list.reason };

  const approvals = list.transactions.filter(isApproval);
  const cancels   = list.transactions.filter(isCancel);

  // 한 번에 읽어 메모리에서 맞춘다 — 하루치 거래는 많아야 수백 건
  const paymentKeys = [...new Set(approvals.map((t) => t.paymentKey))];
  const cancelKeys  = [...new Set(cancels.map((t) => t.transactionKey))];
  const [knownPayments, knownRefunds] = await Promise.all([
    paymentKeys.length === 0 ? Promise.resolve([]) : prisma.tbBlPayment.findMany({
      where:  { pg_pymnt_key: { in: paymentKeys }, pymnt_ty_code: { not: PAYMENT_TYPE.REFUND } },
      select: { pg_pymnt_key: true, amt: true },
    }),
    cancelKeys.length === 0 ? Promise.resolve([]) : prisma.tbBlPayment.findMany({
      where:  { pg_cancel_key: { in: cancelKeys }, pymnt_ty_code: PAYMENT_TYPE.REFUND },
      select: { pg_cancel_key: true, amt: true },
    }),
  ]);
  const paymentAmt = new Map(knownPayments.map((r) => [r.pg_pymnt_key!, r.amt]));
  const refundAmt  = new Map(knownRefunds.map((r) => [r.pg_cancel_key!, -r.amt]));  // 환불 행은 음수 저장

  const unmatchedApprovals = approvals
    .filter((t) => !paymentAmt.has(t.paymentKey))
    .map((t) => ({ orderId: t.orderId, paymentKey: t.paymentKey, amount: t.amount, at: t.transactionAt.toISOString() }));
  const unmatchedCancels = cancels
    .filter((t) => !refundAmt.has(t.transactionKey))
    .map((t) => ({ transactionKey: t.transactionKey, paymentKey: t.paymentKey, amount: t.amount, at: t.transactionAt.toISOString() }));
  const amountMismatches: Array<{ key: string; kind: "approval" | "cancel"; pgAmount: number; ourAmount: number }> = [];
  for (const t of approvals) {
    const ours = paymentAmt.get(t.paymentKey);
    if (ours !== undefined && ours !== t.amount) amountMismatches.push({ key: t.paymentKey, kind: "approval", pgAmount: t.amount, ourAmount: ours });
  }
  for (const t of cancels) {
    const ours = refundAmt.get(t.transactionKey);
    if (ours !== undefined && ours !== t.amount) amountMismatches.push({ key: t.transactionKey, kind: "cancel", pgAmount: t.amount, ourAmount: ours });
  }

  if (unmatchedApprovals.length > 0 || unmatchedCancels.length > 0 || amountMismatches.length > 0) {
    console.error(`[billing/reconcile] 불일치 — 승인 ${unmatchedApprovals.length}건, 취소 ${unmatchedCancels.length}건, 금액 ${amountMismatches.length}건`, { unmatchedApprovals, unmatchedCancels, amountMismatches });
  }
  return { supported: true, checked: list.transactions.length, unmatchedApprovals, unmatchedCancels, amountMismatches, windowStart: windowStart.toISOString() };
}
