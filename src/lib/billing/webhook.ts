/**
 * billing/webhook — PG 웹훅 이벤트 종류별 처리 (라우트는 얇게, 규칙은 여기)
 *
 * 원칙 (정책 §1-10, §7-3):
 *   청구는 우리가 동기 API 로 직접 하고 결과를 바로 반영하므로, 웹훅은 "대조" 용도다.
 *   상태를 바꾸는 처리는 토스에서 검증된(verified:true) 이벤트에만 한다.
 *
 * 처리하는 것:
 *   PAYMENT_STATUS_CHANGED
 *     DONE                        → 우리 이력(pg_pymnt_key)과 주문번호·금액·PG 까지 비교해 일치 확인. 불일치는 FAILED(경보).
 *                                   ⚠ 자동결제(빌링) 승인은 토스가 웹훅을 보내지 않는다(토스 문서, 2026-09-30 확인) —
 *                                   그래서 "PG 승인·DB 미반영" 탐지는 PENDING 조회(subscription.ts)와 거래 조회 대사가 맡는다.
 *                                   이력 없는 DONE 이 오면(일반 결제 등) 기록만 하고 경고한다.
 *     CANCELED / PARTIAL_CANCELED → 토스 콘솔에서 취소(환불)한 건을 REFUND 이력으로 대조한다(정책 §1-7 "환불은 콘솔 수동").
 *                                   관리자가 먼저 기록한 환불 행(pg_cancel_key 없음·금액 일치)이 있으면 취소 키만 연결하고,
 *                                   없으면 운영 보정(ADJUSTMENT) 환불 행을 만든다. 구독 종료는 하지 않는다 —
 *                                   청약철회로 구독까지 끝내려면 관리자 화면의 청약철회 기록을 먼저 하고 콘솔에서 취소한다.
 *   BILLING_DELETED               → 빌링키는 암호화 저장이라 어느 구독인지 찾을 수 없다. 기록만 하고, 다음 청구가
 *                                   실패하면 재시도 정책(PAST_DUE → 카드 변경 안내)이 처리한다.
 *   그 외                          → 기록만 (IGNORED)
 *
 * Mock 게이트웨이의 웹훅은 전부 기록만 한다(청구가 동기라 대조할 것이 없다).
 *
 * 재처리: 라우트는 일시 오류(DB 등)면 500 을 돌려줘 토스 재전송을 받고, 재전송(같은 transmission-id)이 오면
 *         RECEIVED/FAILED 행을 다시 처리한다(PROCESSED/IGNORED 는 건너뜀). 그래서 처리 함수는 멱등해야 한다 —
 *         환불 대조는 취소 키(pg_cancel_key)로, 승인 대조는 읽기만이라 여러 번 돌아도 결과가 같다.
 */

import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { refundedAmountByOriginal } from "./admin-queries";
import {
  PAYMENT_STATUS,
  PAYMENT_TYPE,
  PG_EVENT_STATUS,
  PG_PROVIDER,
  REFUND_REASON,
  type PgProviderCode,
} from "./constants";
import type { PgEvent } from "./gateway";
import { TOSS_PAYMENT_STATUS, TOSS_WEBHOOK_EVENT, type TossCancel, type TossPayment, type TossWebhookPayload } from "./gateway-toss";

type PgEventStatus = (typeof PG_EVENT_STATUS)[keyof typeof PG_EVENT_STATUS];

/** transient=true: 일시 오류(DB 등) — 라우트가 500 을 돌려줘 토스가 재전송하게 한다 */
export type PgEventOutcome = { status: PgEventStatus; reason: string; transient?: true };

/** 웹훅 1건 처리 — 예외를 던지지 않는다(라우트가 결과를 이벤트 행에 남긴다) */
export async function processPgEvent(provider: PgProviderCode, event: PgEvent, now = new Date()): Promise<PgEventOutcome> {
  if (provider !== PG_PROVIDER.TOSS) {
    return { status: PG_EVENT_STATUS.IGNORED, reason: "Mock: 청구는 동기 API 로 반영 — 웹훅은 기록만" };
  }
  const payload = event.payload as TossWebhookPayload;

  try {
    if (event.eventType === TOSS_WEBHOOK_EVENT.PAYMENT_STATUS_CHANGED) {
      if (!payload.verified) {
        return { status: PG_EVENT_STATUS.IGNORED, reason: "결제 조회로 검증되지 않은 이벤트 — 처리하지 않음" };
      }
      return await processTossPaymentStatus(payload.payment, now);
    }
    if (event.eventType === TOSS_WEBHOOK_EVENT.BILLING_DELETED) {
      console.warn("[billing/webhook] 토스 빌링키 삭제 통지 — 다음 정기 결제가 실패하면 재시도 정책으로 처리됨", payload);
      return { status: PG_EVENT_STATUS.IGNORED, reason: "빌링키 삭제 통지 — 빌링키는 암호화 저장이라 구독 대조 불가. 다음 청구 실패 시 재시도 정책으로 처리" };
    }
    return { status: PG_EVENT_STATUS.IGNORED, reason: "처리 대상이 아닌 이벤트 종류 — 원문 기록만" };
  } catch (err) {
    console.error(`[billing/webhook] 처리 오류 eventType=${event.eventType} id=${event.providerEventId}`, err);
    return { status: PG_EVENT_STATUS.FAILED, reason: `처리 오류: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500), transient: true };
  }
}

// ─── PAYMENT_STATUS_CHANGED ──────────────────────────────────────────────────

async function processTossPaymentStatus(payment: TossPayment, now: Date): Promise<PgEventOutcome> {
  // 원 결제 행 — 환불 행도 같은 pg_pymnt_key 를 갖고 있으므로 제외
  const original = await prisma.tbBlPayment.findFirst({
    where:   { pg_pymnt_key: payment.paymentKey, pymnt_ty_code: { not: PAYMENT_TYPE.REFUND } },
    orderBy: { creat_dt: "asc" },
  });

  if (!original) {
    // 빌링 승인은 웹훅이 오지 않으므로 여기 오는 DONE 은 우리 흐름 밖의 결제(콘솔 수동 결제 등)거나,
    // PENDING 조회가 아직 확정하지 못한 건일 수 있다 → 경고만. 확정은 PENDING 조회·거래 조회 대사가 한다
    if (payment.status === TOSS_PAYMENT_STATUS.DONE) {
      console.warn(`[billing/webhook] 이력에 없는 승인 결제 통지 — paymentKey=${payment.paymentKey} orderId=${payment.orderId} amount=${payment.totalAmount}. 거래 조회 대사에서 확인`);
      return { status: PG_EVENT_STATUS.IGNORED, reason: `이력에 없는 승인 결제(orderId=${payment.orderId}, ${payment.totalAmount}원) — 거래 조회 대사 대상` };
    }
    return { status: PG_EVENT_STATUS.IGNORED, reason: `결제 이력에 없는 결제(status=${payment.status}) — 처리 대상 아님` };
  }

  // 대조 — 키만 같고 주문번호·금액·PG 가 다르면 뭔가 잘못된 것(경보)
  const mismatch: string[] = [];
  if (original.pg_order_id !== payment.orderId) mismatch.push(`주문번호 ${original.pg_order_id}≠${payment.orderId}`);
  if (original.amt !== payment.totalAmount) mismatch.push(`금액 ${original.amt}≠${payment.totalAmount}`);
  if (original.pg_provdr_code !== PG_PROVIDER.TOSS) mismatch.push(`PG ${original.pg_provdr_code}≠TOSS`);
  if (mismatch.length > 0) {
    console.error(`[billing/webhook] CRITICAL 결제 대조 불일치 paymentKey=${payment.paymentKey}: ${mismatch.join(", ")}`);
    return { status: PG_EVENT_STATUS.FAILED, reason: `대조 불일치: ${mismatch.join(", ")}` };
  }

  if (payment.status === TOSS_PAYMENT_STATUS.DONE) {
    return { status: PG_EVENT_STATUS.PROCESSED, reason: `승인 확인 — 결제 이력 ${original.pg_order_id} 과 주문번호·금액 일치` };
  }
  if (payment.status === TOSS_PAYMENT_STATUS.CANCELED || payment.status === TOSS_PAYMENT_STATUS.PARTIAL_CANCELED) {
    return reconcileRefunds(original.pymnt_id, payment.cancels ?? [], now);
  }
  return { status: PG_EVENT_STATUS.IGNORED, reason: `상태 ${payment.status} 는 처리 대상 아님` };
}

// ─── 취소(환불) 대조 ─────────────────────────────────────────────────────────

/**
 * 토스 cancels[] 를 REFUND 이력과 맞춘다. 원 결제 행을 FOR UPDATE 로 잠가 관리자 환불 기록과 교차하지 않게 한다.
 *   이미 같은 transactionKey 로 연결된 행 → 건너뜀
 *   관리자가 먼저 기록한 행(키 없음·금액 일치) → 키만 연결
 *   없음 → ADJUSTMENT 환불 행 생성
 * 마지막에 누적 환불액으로 원 결제 상태(PARTIALLY_REFUNDED / REFUNDED)를 다시 계산한다.
 */
async function reconcileRefunds(originalId: string, cancels: TossCancel[], now: Date): Promise<PgEventOutcome> {
  const done = cancels.filter((c) => !c.cancelStatus || c.cancelStatus === "DONE");
  if (done.length === 0) {
    return { status: PG_EVENT_STATUS.IGNORED, reason: "완료된 취소 내역이 없음" };
  }

  const counts = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pymnt_id FROM tb_bl_payment WHERE pymnt_id = ${originalId} FOR UPDATE`;
    const original = await tx.tbBlPayment.findUniqueOrThrow({ where: { pymnt_id: originalId } });

    let linked = 0, created = 0, skipped = 0;
    for (const c of done) {
      const already = await tx.tbBlPayment.findFirst({ where: { pg_cancel_key: c.transactionKey, pymnt_ty_code: PAYMENT_TYPE.REFUND } });
      if (already) { skipped += 1; continue; }

      const unlinked = await tx.tbBlPayment.findFirst({
        where:   { orig_pymnt_id: originalId, pymnt_ty_code: PAYMENT_TYPE.REFUND, pg_cancel_key: null, amt: -c.cancelAmount },
        orderBy: { creat_dt: "asc" },
      });
      if (unlinked) {
        await tx.tbBlPayment.update({ where: { pymnt_id: unlinked.pymnt_id }, data: { pg_cancel_key: c.transactionKey } });
        linked += 1;
        continue;
      }

      await tx.tbBlPayment.create({ data: refundRowFromCancel(original, c, now) });
      created += 1;
    }

    // 누적 환불액 → 원 결제 상태. 관리자 기록과 웹훅 생성분이 섞여도 합계로 판정하므로 일관된다
    const refunded = (await refundedAmountByOriginal([originalId], tx)).get(originalId) ?? 0;
    if (refunded > 0) {
      const status = refunded >= original.amt ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIALLY_REFUNDED;
      if (original.pymnt_sttus_code !== status) {
        await tx.tbBlPayment.update({ where: { pymnt_id: originalId }, data: { pymnt_sttus_code: status } });
      }
    }
    return { linked, created, skipped };
  });

  return {
    status: PG_EVENT_STATUS.PROCESSED,
    reason: `환불 대조: 연결 ${counts.linked}건 · 생성 ${counts.created}건 · 기존 ${counts.skipped}건`,
  };
}

function refundRowFromCancel(
  original: { pymnt_id: string; sbscrptn_id: string | null; mber_id: string; seat_cnt: number; perd_bgng_dt: Date | null; perd_end_dt: Date | null; pg_provdr_code: string; pg_pymnt_key: string | null; receipt_url: string | null },
  c: TossCancel,
  now: Date,
): Prisma.TbBlPaymentUncheckedCreateInput {
  const stamp = now.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  return {
    sbscrptn_id:      original.sbscrptn_id,
    mber_id:          original.mber_id,
    pymnt_ty_code:    PAYMENT_TYPE.REFUND,
    amt:              -c.cancelAmount,
    seat_cnt:         original.seat_cnt,
    perd_bgng_dt:     original.perd_bgng_dt,
    perd_end_dt:      original.perd_end_dt,
    pymnt_sttus_code: PAYMENT_STATUS.REFUNDED,
    pg_provdr_code:   original.pg_provdr_code,
    pg_pymnt_key:     original.pg_pymnt_key,
    pg_order_id:      `SPC-RF-${stamp}-${randomBytes(4).toString("hex").toUpperCase()}`,
    receipt_url:      original.receipt_url,
    fail_rsn_cn:      `PG 콘솔 취소(웹훅 대조): ${c.cancelReason}`.slice(0, 500),
    apprv_dt:         c.canceledAt ? new Date(c.canceledAt) : now,
    orig_pymnt_id:    original.pymnt_id,
    refund_rsn_code:  REFUND_REASON.ADJUSTMENT,
    pg_cancel_key:    c.transactionKey,
    creat_dt:         now,
  };
}
