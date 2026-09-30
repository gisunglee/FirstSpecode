/**
 * billing/admin-actions — 관리자 결제 운영 액션 (SUPER_ADMIN 전용 라우트에서만 호출)
 *
 *   adminRetryCharge     즉시 재결제 (PAST_DUE) — PG 호출 전 감사 "시도" 기록 → 결과로 갱신
 *   adminDeferBilling    다음 결제일 N일 연기 (ACTIVE) — 결제 진행 중이면 409
 *   adminTerminate       강제 종료 (CANCELED, 사유 ADMIN_TERMINATE)
 *   adminRecordRefund    환불 실행+기록 — PG 취소 API 호출. 청약철회(전액·구독 종료) / 운영 보정(전액·부분·구독 유지)
 *   adminUnlockProject   잠금 해제 대행 — 소유자 "활성화"와 같은 상한 판정 (강제 없음)
 *
 * 원칙 (정책 §1-7, §1-10):
 *   - 좌석·단가·플랜은 건드리지 않는다. 구독이 플랜의 원천. 보상은 "결제일 연기"로만.
 *   - 상한을 초과한 프로젝트를 강제로 풀지 않는다. 풀어 줘야 하면 관리자 수동 플랜 부여 → 대행 해제.
 *   - 돈이 움직이는 액션은 상태 변경과 감사 기록을 **같은 트랜잭션**에 넣는다(logAdminActionStrict).
 *     감사 행이 안 남으면 변경도 롤백된다.
 *   - 결제 진행 중(billing_op_token 살아 있음)에는 구독을 바꾸지 않는다 — guardedSubscriptionUpdate /
 *     terminateSubscriptionTx 가 409 로 막는다.
 *   - 환불은 관리자 화면에서 PG 취소 API 를 직접 실행하고 원장(REFUND 행 + 원 결제 상태)을 남긴다 (2026-09-30).
 */

import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logAdminActionStrict, type LogAdminActionInput } from "@/lib/audit";
import { getWithdrawalEligibility, WITHDRAWAL_WINDOW_DAYS } from "./withdrawal";
import {
  BILLING_ERROR_CODES as E,
  ENDED_REASON,
  isLiveSubscriptionStatus,
  PAYMENT_STATUS,
  PAYMENT_TYPE,
  REFUND_REASON,
  SUBSCRIPTION_STATUS as S,
  type RefundReason,
} from "./constants";
import { BillingError } from "./errors";
import { getPaymentGateway } from "./gateway";
import { isProjectOverPlanLimit, type OverLimitVerdict } from "./lock";
import { addDays, formatKstDate } from "./pricing";
import { refundedAmountByOriginal } from "./admin-queries";
import {
  attemptRecurringCharge,
  concurrentOperationError,
  guardedSubscriptionUpdate,
  isBillingOperationLive,
  sendTerminationNotice,
  terminateSubscriptionTx,
  toPaymentDto,
  toSubscriptionDto,
  type PaymentDto,
  type RecurringChargeResult,
  type SubscriptionDto,
} from "./subscription";

/** 감사 로그에 들어갈 관리자 컨텍스트 — requireSystemAdmin 결과에서 뽑는다 */
export type AdminActor = { mberId: string; ipAddr?: string | null; userAgent?: string | null };

function auditBase(actor: AdminActor): Pick<LogAdminActionInput, "adminMberId" | "ipAddr" | "userAgent"> {
  return { adminMberId: actor.mberId, ipAddr: actor.ipAddr ?? null, userAgent: actor.userAgent ?? null };
}

async function requireSub(sbscrptnId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const sub = await db.tbBlSubscription.findUnique({
    where: { sbscrptn_id: sbscrptnId },
    include: { member: { select: { email_addr: true } } },
  });
  if (!sub) throw new BillingError(E.NO_SUBSCRIPTION, "구독을 찾을 수 없습니다.", 404);
  return sub;
}

// ═══════════════════════════════════════════════════════════════════════════
// 즉시 재결제
// ═══════════════════════════════════════════════════════════════════════════

/**
 * PAST_DUE 구독을 배치의 3일 간격을 기다리지 않고 지금 청구한다 ("카드 고쳤어요" 민원).
 * PG 를 호출하므로 감사는 두 단계 — 호출 전 "시도" 행(실패해도 시도 흔적이 남게), 결과로 memo 갱신.
 * 결과 실패면 fail_cnt 가 올라가고 소진 시 강등까지 배치와 같은 함수가 처리한다.
 */
export async function adminRetryCharge(sbscrptnId: string, actor: AdminActor, reason: string, now = new Date()): Promise<RecurringChargeResult> {
  const sub = await requireSub(sbscrptnId);
  if (sub.sbscrptn_sttus_code !== S.PAST_DUE) {
    throw new BillingError(E.INVALID_STATE, "재시도 중(PAST_DUE) 구독에서만 즉시 재결제할 수 있습니다.", 409);
  }
  const auditId = await logAdminActionStrict(prisma, {
    ...auditBase(actor), actionType: "BILLING_RETRY_CHARGE", targetType: "SUBSCRIPTION", targetId: sbscrptnId,
    memo: `[즉시 재결제 시도] fail_cnt=${sub.fail_cnt} · ${reason}`,
  });
  const result = await attemptRecurringCharge(sub, sub.member.email_addr ?? "", now, "RETRY");
  const outcome =
    result.ok ? `성공 ${result.amount.toLocaleString("ko-KR")}원${result.applied ? "" : " (구독 반영 지연 — 수동 대조)"}`
    : result.skipped ? "다른 결제 처리 진행 중 → 건너뜀"
    : `실패 fail_cnt=${result.failCnt}${result.expired ? " → EXPIRED 강등" : ""}`;
  await prisma.tbSysAdminAudit.update({
    where: { audit_id: auditId },
    data:  { memo: `[즉시 재결제] ${outcome} · ${reason}` },
  }).catch((e) => console.error("[billing/admin] 재결제 감사 갱신 실패:", e));
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// 다음 결제일 연기
// ═══════════════════════════════════════════════════════════════════════════

export const DEFER_DAYS_LIMITS = { min: 1, max: 90 } as const;

/**
 * 장애 보상·민원 처리용. ACTIVE 에서만. 주기 종료·다음 결제일을 N일 뒤로 밀고 사전 안내는 새 날짜로 다시 나가게 리셋.
 * 좌석·단가는 그대로 — 무상 이용 기간이 늘어나는 것뿐. 결제 진행 중이면 409.
 */
export async function adminDeferBilling(sbscrptnId: string, days: number, actor: AdminActor, reason: string, now = new Date()): Promise<SubscriptionDto> {
  if (!Number.isInteger(days) || days < DEFER_DAYS_LIMITS.min || days > DEFER_DAYS_LIMITS.max) {
    throw new BillingError(E.INVALID_STATE, `연기 일수는 ${DEFER_DAYS_LIMITS.min}~${DEFER_DAYS_LIMITS.max}일이어야 합니다.`, 400);
  }
  const updated = await prisma.$transaction(async (tx) => {
    const sub = await requireSub(sbscrptnId, tx);
    if (sub.sbscrptn_sttus_code !== S.ACTIVE || !sub.crrnt_perd_end_dt || !sub.next_bill_dt) {
      throw new BillingError(E.INVALID_STATE, "이용 중(ACTIVE) 구독에서만 결제일을 연기할 수 있습니다.", 409);
    }
    const next = await guardedSubscriptionUpdate(sbscrptnId, {
      crrnt_perd_end_dt: addDays(sub.crrnt_perd_end_dt, days),
      next_bill_dt:      addDays(sub.next_bill_dt, days),
      prentc_dt:         null,
    }, now, tx);
    await logAdminActionStrict(tx, {
      ...auditBase(actor), actionType: "BILLING_DEFER_BILL_DATE", targetType: "SUBSCRIPTION", targetId: sbscrptnId,
      memo: `[결제일 연기 +${days}일] ${formatKstDate(sub.next_bill_dt)} → ${formatKstDate(next.next_bill_dt!)} · ${reason}`,
    });
    return next;
  });
  return toSubscriptionDto(updated, now);
}

// ═══════════════════════════════════════════════════════════════════════════
// 강제 종료
// ═══════════════════════════════════════════════════════════════════════════

/** 운영 사유로 살아 있는 구독을 즉시 CANCELED. 해지 확정과 같은 경로(FREE 강등·잠금·메일). 결제 진행 중이면 409 */
export async function adminTerminate(sbscrptnId: string, actor: AdminActor, reason: string, now = new Date()): Promise<SubscriptionDto> {
  const sub = await requireSub(sbscrptnId);
  if (!isLiveSubscriptionStatus(sub.sbscrptn_sttus_code)) {
    throw new BillingError(E.INVALID_STATE, "이미 종료된 구독입니다.", 409);
  }
  const result = await prisma.$transaction(async (tx) => {
    const r = await terminateSubscriptionTx(tx, sub, S.CANCELED, now, ENDED_REASON.ADMIN_TERMINATE);
    await logAdminActionStrict(tx, {
      ...auditBase(actor), actionType: "BILLING_FORCE_TERMINATE", targetType: "SUBSCRIPTION", targetId: sbscrptnId,
      memo: `[강제 종료] ${sub.sbscrptn_sttus_code} → CANCELED · 잠금 ${r.lockedCount}개 · ${reason}`,
    });
    return r;
  });
  await sendTerminationNotice(sub, S.CANCELED, sub.member.email_addr, result);
  return toSubscriptionDto(await requireSub(sbscrptnId), now);
}

// ═══════════════════════════════════════════════════════════════════════════
// 환불 기록
// ═══════════════════════════════════════════════════════════════════════════

export type RefundInput = {
  reason: RefundReason;
  /** ADJUSTMENT 만. 생략하면 잔액 전액 */
  amount?: number;
  memo: string;
};

export type RefundResult = {
  refund:   PaymentDto;
  original: PaymentDto;
  /** WITHDRAWAL 로 구독이 함께 종료됐으면 true */
  subscriptionTerminated: boolean;
};

/**
 * 환불 실행 + 원장 — PG 취소 API 를 직접 부른다 (2026-09-30, "콘솔 수동 → 관리자 화면 실행"으로 정책 변경 §1-7).
 *
 *   WITHDRAWAL 청약철회: 계정의 첫 구독 시작 결제(계정당 1회)·승인 후 7일 이내(사용 여부 무관). 잔액 전액,
 *                        구독이 살아 있으면 확정 트랜잭션에서 종료(사유 REFUND_WITHDRAWAL). 이미 종료면 기록만.
 *   ADJUSTMENT 운영 보정: 이중 청구·과청구·장애 보상. 금액은 1원 ~ 잔액. 구독은 그대로.
 *
 * 순서 (PG 호출은 트랜잭션 밖 — 청구와 같은 원칙):
 *   ① 준비 tx: 원 결제 행 FOR UPDATE → 잔액·금액 확정 → REFUND 행을 **PENDING** 으로 생성(pndng_lock_key=회원 →
 *      진행 중 청구가 있으면 UNIQUE 충돌로 409, 환불 중엔 새 청구도 못 들어온다) → 감사 "시도"
 *   ② PG 취소 (멱등키 = 환불 행 주문 ID → 재시도해도 한 번만 취소)
 *   ③ 확정 tx: 환불 행 REFUNDED + 취소 키 → 원 결제 상태 재계산 → 청약철회면 구독 종료 → 감사 memo 갱신
 *   PG 거절이면 환불 행 FAILED 로 남기고 502. PG 는 취소됐는데 ③ 이 실패하면 CRITICAL 로그 + 환불 행만 REFUNDED 로
 *   최대한 남긴다(구독 종료는 사람이 마무리). 콘솔에서 직접 취소한 건은 웹훅 대조(webhook.ts)가 ADJUSTMENT 로 잡는다.
 *
 * 동시성: 같은 결제를 두 창에서 동시에 환불하면 두 번째는 첫 번째 커밋 뒤에 잔액을 보므로 초과 환불이 나지 않는다.
 * 원 결제 상태: 누적 < 원 금액 → PARTIALLY_REFUNDED, 누적 = 원 금액 → REFUNDED.
 */
export async function adminRecordRefund(paymentId: string, input: RefundInput, actor: AdminActor, now = new Date()): Promise<RefundResult> {
  const original = await prisma.tbBlPayment.findUnique({ where: { pymnt_id: paymentId } });
  if (!original) throw new BillingError(E.INVALID_STATE, "결제 건을 찾을 수 없습니다.", 404);
  if (original.pymnt_ty_code === PAYMENT_TYPE.REFUND || original.pymnt_sttus_code === PAYMENT_STATUS.FAILED) {
    throw new BillingError(E.REFUND_NOT_ALLOWED, "환불 행이나 실패한 결제는 환불할 수 없습니다.", 409);
  }
  if (original.pymnt_sttus_code === PAYMENT_STATUS.PENDING) {
    throw new BillingError(E.REFUND_NOT_ALLOWED, "결과 확인 중인 결제는 환불할 수 없습니다. 확정된 뒤 처리하세요.", 409);
  }
  if (!original.pg_pymnt_key) {
    throw new BillingError(E.INVALID_STATE, "PG 결제 키가 없는 결제는 취소할 수 없습니다.", 409);
  }
  const gw = getPaymentGateway();
  if (original.pg_provdr_code !== gw.provider) {
    throw new BillingError(E.PROVIDER_MISMATCH, `이 결제는 ${original.pg_provdr_code} 결제라 현재 결제 시스템(${gw.provider})에서 취소할 수 없습니다.`, 409);
  }

  // 청약철회 조건은 트랜잭션 밖에서 미리 판정 — 계정의 첫 구독 시작 결제(계정당 1회)·승인 7일 이내.
  // 사용 여부는 보지 않는다(정책 §1-7, 2026-09-26). 화면 표시와 같은 함수(withdrawal.ts)를 쓴다.
  if (input.reason === REFUND_REASON.WITHDRAWAL) {
    const elig = await getWithdrawalEligibility(original.mber_id, now);
    if (elig.firstPaymentId !== original.pymnt_id) {
      throw new BillingError(E.REFUND_NOT_ALLOWED, "청약철회는 계정의 첫 구독 시작 결제에만 적용됩니다(계정당 1회). 정기 결제·좌석 추가·재구독 결제는 운영 보정으로 처리하세요.", 409);
    }
    if (elig.reason === "WINDOW_PASSED") {
      throw new BillingError(E.REFUND_NOT_ALLOWED, `청약철회는 결제 후 ${WITHDRAWAL_WINDOW_DAYS}일 이내에만 가능합니다(승인 ${formatKstDate(new Date(elig.firstPaidAt!))}, 기한 ${formatKstDate(new Date(elig.deadline!))}). 그 외는 운영 보정으로 처리하세요.`, 409);
    }
    // ALREADY_REFUNDED 는 아래 준비 트랜잭션의 잔액 검사(전액 환불 409 / 일부 환불 409)가 같은 결론을 낸다
  }

  const stamp = now.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);

  // ── ① 준비: 금액 확정 + PENDING 환불 행 + 감사 "시도" ─────────────────────
  const prep = await prisma.$transaction(async (tx) => {
    // 원 결제 행 잠금 — 동시 환불이 누적액을 같은 시점에 읽지 못하게
    await tx.$queryRaw`SELECT pymnt_id FROM tb_bl_payment WHERE pymnt_id = ${paymentId} FOR UPDATE`;
    const locked = await tx.tbBlPayment.findUniqueOrThrow({ where: { pymnt_id: paymentId } });
    if (locked.pymnt_sttus_code === PAYMENT_STATUS.REFUNDED) {
      throw new BillingError(E.REFUND_NOT_ALLOWED, "이미 전액 환불된 결제입니다.", 409);
    }
    const refundedSoFar = (await refundedAmountByOriginal([paymentId], tx)).get(paymentId) ?? 0;
    const remaining = locked.amt - refundedSoFar;

    let amount: number;
    if (input.reason === REFUND_REASON.WITHDRAWAL) {
      if (refundedSoFar > 0) throw new BillingError(E.REFUND_NOT_ALLOWED, "이미 일부 환불된 결제는 청약철회로 처리할 수 없습니다.", 409);
      amount = locked.amt;
    } else {
      amount = input.amount ?? remaining;
      if (!Number.isInteger(amount) || amount < 1 || amount > remaining) {
        throw new BillingError(E.REFUND_NOT_ALLOWED, `환불 금액은 1원 이상, 잔액(${remaining.toLocaleString("ko-KR")}원) 이하여야 합니다.`, 400);
      }
    }

    // 진행 중인 청구(결제 작업 토큰)가 있으면 지금 환불하지 않는다 — 결과가 교차하면 원장이 흐려진다
    if (locked.sbscrptn_id) {
      const sub = await tx.tbBlSubscription.findUnique({ where: { sbscrptn_id: locked.sbscrptn_id } });
      if (sub && isBillingOperationLive(sub, now)) throw concurrentOperationError();
    }

    let refund;
    try {
      refund = await tx.tbBlPayment.create({
        data: {
          sbscrptn_id:      locked.sbscrptn_id,
          mber_id:          locked.mber_id,
          pymnt_ty_code:    PAYMENT_TYPE.REFUND,
          amt:              -amount,
          seat_cnt:         locked.seat_cnt,
          perd_bgng_dt:     locked.perd_bgng_dt,
          perd_end_dt:      locked.perd_end_dt,
          pymnt_sttus_code: PAYMENT_STATUS.PENDING,
          pg_provdr_code:   locked.pg_provdr_code,
          pg_pymnt_key:     locked.pg_pymnt_key,
          pg_order_id:      `SPC-RF-${stamp}-${randomBytes(4).toString("hex").toUpperCase()}`,
          receipt_url:      locked.receipt_url,
          fail_rsn_cn:      input.memo,
          orig_pymnt_id:    locked.pymnt_id,
          refund_rsn_code:  input.reason,
          pndng_lock_key:   locked.mber_id,
          creat_dt:         now,
        },
      });
    } catch (err) {
      // 회원당 진행 중 1건 — 청구 시도가 PENDING 으로 남아 있으면 환불도 기다린다
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw concurrentOperationError();
      throw err;
    }
    const auditId = await logAdminActionStrict(tx, {
      ...auditBase(actor), actionType: "BILLING_REFUND_RECORD", targetType: "PAYMENT", targetId: paymentId,
      memo: `[환불 시도 ${input.reason}] ${amount.toLocaleString("ko-KR")}원 / 원 결제 ${locked.amt.toLocaleString("ko-KR")}원 (${locked.pg_order_id}) · ${input.memo}`,
    });
    return { locked, refund, amount, auditId };
  });
  const { locked, refund, amount, auditId } = prep;

  // ── ② PG 취소 ─────────────────────────────────────────────────────────────
  const cancel = await gw.cancelPayment({
    paymentKey:     locked.pg_pymnt_key!,
    amount,
    reason:         `${input.reason === REFUND_REASON.WITHDRAWAL ? "청약철회" : "운영 보정"}: ${input.memo}`.slice(0, 200),
    idempotencyKey: refund.pg_order_id,
  });
  if (!cancel.ok) {
    await prisma.tbBlPayment.updateMany({
      where: { pymnt_id: refund.pymnt_id, pymnt_sttus_code: PAYMENT_STATUS.PENDING },
      data:  { pymnt_sttus_code: PAYMENT_STATUS.FAILED, fail_rsn_cn: `PG 취소 실패 ${cancel.code}: ${cancel.message} · ${input.memo}`.slice(0, 500), pndng_lock_key: null },
    });
    await prisma.tbSysAdminAudit.update({ where: { audit_id: auditId }, data: { memo: `[환불 실패 ${input.reason}] PG 거절 ${cancel.code}: ${cancel.message} · ${input.memo}` } })
      .catch((e) => console.error("[billing/admin] 환불 감사 갱신 실패:", e));
    throw new BillingError(E.GATEWAY_UNAVAILABLE, `PG 취소가 거절되었습니다. ${cancel.message}`, 502, { pgCode: cancel.code });
  }

  // ── ③ 확정 ────────────────────────────────────────────────────────────────
  let result: { updatedOriginal: Awaited<ReturnType<typeof prisma.tbBlPayment.update>>; terminated: boolean; termination: Awaited<ReturnType<typeof terminateSubscriptionTx>> | null; sub: Awaited<ReturnType<typeof requireSub>> | null };
  try {
    result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pymnt_id FROM tb_bl_payment WHERE pymnt_id = ${paymentId} FOR UPDATE`;
      const r = await tx.tbBlPayment.updateMany({
        where: { pymnt_id: refund.pymnt_id, pymnt_sttus_code: PAYMENT_STATUS.PENDING },
        data:  { pymnt_sttus_code: PAYMENT_STATUS.REFUNDED, pg_cancel_key: cancel.cancelKey, apprv_dt: now, pndng_lock_key: null },
      });
      if (r.count !== 1) throw new Error("환불 행이 이미 확정돼 있음");
      const refundedNow = (await refundedAmountByOriginal([paymentId], tx)).get(paymentId) ?? 0;
      const newStatus = refundedNow >= locked.amt ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIALLY_REFUNDED;
      const updatedOriginal = await tx.tbBlPayment.update({ where: { pymnt_id: paymentId }, data: { pymnt_sttus_code: newStatus } });

      // 청약철회 → 구독도 같은 트랜잭션에서 종료 (살아 있을 때만)
      let terminated = false;
      let termination: Awaited<ReturnType<typeof terminateSubscriptionTx>> | null = null;
      let sub = null as Awaited<ReturnType<typeof requireSub>> | null;
      if (input.reason === REFUND_REASON.WITHDRAWAL && locked.sbscrptn_id) {
        sub = await requireSub(locked.sbscrptn_id, tx);
        if (isLiveSubscriptionStatus(sub.sbscrptn_sttus_code)) {
          termination = await terminateSubscriptionTx(tx, sub, S.CANCELED, now, ENDED_REASON.REFUND_WITHDRAWAL);
          terminated = true;
        }
      }
      await tx.tbSysAdminAudit.update({
        where: { audit_id: auditId },
        data:  { memo: `[환불 실행 ${input.reason}] ${amount.toLocaleString("ko-KR")}원 / 원 결제 ${locked.amt.toLocaleString("ko-KR")}원 (${locked.pg_order_id}) → ${newStatus} · PG 취소 키 ${cancel.cancelKey ?? "-"}${terminated ? " · 구독 종료(REFUND_WITHDRAWAL)" : ""} · ${input.memo}` },
      });
      return { updatedOriginal, terminated, termination, sub };
    });
  } catch (err) {
    // PG 는 이미 취소했다 — 환불 행만이라도 확정해 두고(원장 누락 방지) 나머지는 사람이 마무리
    console.error(`[billing/admin] CRITICAL PG 취소 완료(cancelKey=${cancel.cancelKey}) 뒤 원장 확정 실패 — refund=${refund.pymnt_id} original=${paymentId}. 원 결제 상태·구독 종료 수동 확인 필요`, err);
    await prisma.tbBlPayment.updateMany({
      where: { pymnt_id: refund.pymnt_id, pymnt_sttus_code: PAYMENT_STATUS.PENDING },
      data:  { pymnt_sttus_code: PAYMENT_STATUS.REFUNDED, pg_cancel_key: cancel.cancelKey, apprv_dt: now, pndng_lock_key: null },
    }).catch(() => undefined);
    throw new BillingError(E.RECONCILE_REQUIRED, "PG 취소는 완료됐지만 원장 확정에 실패했습니다. 결제 이력과 구독 상태를 수동으로 확인해 주세요.", 500);
  }

  if (result.terminated && result.sub && result.termination) {
    await sendTerminationNotice(result.sub, S.CANCELED, result.sub.member.email_addr, result.termination);
  }
  const finalRefund = await prisma.tbBlPayment.findUniqueOrThrow({ where: { pymnt_id: refund.pymnt_id } });
  return { refund: toPaymentDto(finalRefund), original: toPaymentDto(result.updatedOriginal), subscriptionTerminated: result.terminated };
}

// ═══════════════════════════════════════════════════════════════════════════
// 잠금 해제 대행
// ═══════════════════════════════════════════════════════════════════════════

export type AdminUnlockResult =
  | { unlocked: true; alreadyActive: boolean }
  | { unlocked: false; verdict: Extract<OverLimitVerdict, { over: true }> };

/**
 * 소유자 "활성화"와 같은 판정으로 관리자가 대신 푼다(소유자 연락 불가 등). 상한 초과면 풀지 않는다 —
 * 운영 판단으로 풀어 줘야 하면 관리자 수동 플랜 부여(4단계) 뒤 다시 대행하면 판정을 통과한다.
 * 해제와 감사는 같은 트랜잭션.
 */
export async function adminUnlockProject(projectId: string, actor: AdminActor, reason: string, now = new Date()): Promise<AdminUnlockResult> {
  return prisma.$transaction(async (tx) => {
    const project = await tx.tbPjProject.findUnique({ where: { prjct_id: projectId }, select: { del_yn: true, lock_yn: true, prjct_nm: true } });
    if (!project || project.del_yn === "Y") throw new BillingError(E.INVALID_STATE, "프로젝트를 찾을 수 없습니다.", 404);
    if (project.lock_yn !== "Y") return { unlocked: true, alreadyActive: true };

    const verdict = await isProjectOverPlanLimit(projectId, undefined, tx);
    if (verdict.over) return { unlocked: false, verdict };

    const r = await tx.tbPjProject.updateMany({ where: { prjct_id: projectId, lock_yn: "Y" }, data: { lock_yn: "N", lock_dt: null } });
    if (r.count !== 1) throw concurrentOperationError();
    await logAdminActionStrict(tx, {
      ...auditBase(actor), actionType: "PROJECT_UNLOCK_BY_ADMIN", targetType: "PROJECT", targetId: projectId,
      memo: `[잠금 해제 대행] ${project.prjct_nm} · ${reason}`,
    });
    void now;
    return { unlocked: true, alreadyActive: false };
  });
}
