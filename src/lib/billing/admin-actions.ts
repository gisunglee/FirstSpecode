/**
 * billing/admin-actions — 관리자 결제 운영 액션 (SUPER_ADMIN 전용 라우트에서만 호출)
 *
 *   adminRetryCharge     즉시 재결제 (PAST_DUE) — PG 호출 전 감사 "시도" 기록 → 결과로 갱신
 *   adminDeferBilling    다음 결제일 N일 연기 (ACTIVE) — 결제 진행 중이면 409
 *   adminTerminate       강제 종료 (CANCELED, 사유 ADMIN_TERMINATE)
 *   adminRecordRefund    환불 기록 — 청약철회(전액·구독 종료) / 운영 보정(전액·부분·구독 유지)
 *   adminUnlockProject   잠금 해제 대행 — 소유자 "활성화"와 같은 상한 판정 (강제 없음)
 *
 * 원칙 (정책 §1-7, §1-10):
 *   - 좌석·단가·플랜은 건드리지 않는다. 구독이 플랜의 원천. 보상은 "결제일 연기"로만.
 *   - 상한을 초과한 프로젝트를 강제로 풀지 않는다. 풀어 줘야 하면 관리자 수동 플랜 부여 → 대행 해제.
 *   - 돈이 움직이는 액션은 상태 변경과 감사 기록을 **같은 트랜잭션**에 넣는다(logAdminActionStrict).
 *     감사 행이 안 남으면 변경도 롤백된다.
 *   - 결제 진행 중(billing_op_token 살아 있음)에는 구독을 바꾸지 않는다 — guardedSubscriptionUpdate /
 *     terminateSubscriptionTx 가 409 로 막는다.
 *   - 환불 실행은 PG 콘솔 수동. 여기서는 원장(REFUND 행 + 원 결제 상태)만 남긴다.
 */

import type { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logAdminActionStrict, type LogAdminActionInput } from "@/lib/audit";
import { getPaidFeatureUsage } from "./paidUsage";
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
import { isProjectOverPlanLimit, type OverLimitVerdict } from "./lock";
import { addDays, formatKstDate } from "./pricing";
import { refundedAmountByOriginal } from "./admin-queries";
import {
  attemptRecurringCharge,
  concurrentOperationError,
  guardedSubscriptionUpdate,
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

/** 청약철회 가능 기간(일) — 정책 §1-7 */
const WITHDRAWAL_WINDOW_DAYS = 7;

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
 * 환불 원장 기록 — 환불 실행(PG 콘솔) 뒤에 부른다.
 *
 *   WITHDRAWAL 청약철회: 첫 결제(INITIAL)·승인 후 7일 이내·유료 기능 미사용(paidUsage) 이어야 한다. 잔액 전액,
 *                        구독이 살아 있으면 같은 트랜잭션에서 종료(사유 REFUND_WITHDRAWAL). 이미 종료면 기록만.
 *   ADJUSTMENT 운영 보정: 이중 청구·과청구·장애 보상. 금액은 1원 ~ 잔액. 구독은 그대로.
 *
 * 동시성: 원 결제 행을 SELECT ... FOR UPDATE 로 잠근 뒤 누적 환불액을 다시 읽는다. 같은 결제를 두 창에서
 * 동시에 환불하면 두 번째는 첫 번째 커밋 뒤에 잔액을 보므로 초과 환불이 나지 않는다.
 * 원 결제 상태: 누적 < 원 금액 → PARTIALLY_REFUNDED, 누적 = 원 금액 → REFUNDED.
 */
export async function adminRecordRefund(paymentId: string, input: RefundInput, actor: AdminActor, now = new Date()): Promise<RefundResult> {
  const original = await prisma.tbBlPayment.findUnique({ where: { pymnt_id: paymentId } });
  if (!original) throw new BillingError(E.INVALID_STATE, "결제 건을 찾을 수 없습니다.", 404);
  if (original.pymnt_ty_code === PAYMENT_TYPE.REFUND || original.pymnt_sttus_code === PAYMENT_STATUS.FAILED) {
    throw new BillingError(E.REFUND_NOT_ALLOWED, "환불 행이나 실패한 결제는 환불할 수 없습니다.", 409);
  }

  // 청약철회 조건은 트랜잭션 밖에서 미리 판정 (paidUsage 는 여러 표를 읽는다)
  if (input.reason === REFUND_REASON.WITHDRAWAL) {
    const approvedAt = original.apprv_dt ?? original.creat_dt;
    if (original.pymnt_ty_code !== PAYMENT_TYPE.INITIAL) {
      throw new BillingError(E.REFUND_NOT_ALLOWED, "청약철회는 구독 시작 결제(INITIAL)에만 적용됩니다. 그 외는 운영 보정으로 기록하세요.", 409);
    }
    if (now.getTime() - approvedAt.getTime() > WITHDRAWAL_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
      throw new BillingError(E.REFUND_NOT_ALLOWED, `청약철회는 결제 후 ${WITHDRAWAL_WINDOW_DAYS}일 이내에만 가능합니다(승인 ${formatKstDate(approvedAt)}). 그 외는 운영 보정으로 기록하세요.`, 409);
    }
    const usage = await getPaidFeatureUsage(original.mber_id);
    if (usage.used) {
      throw new BillingError(E.REFUND_NOT_ALLOWED, "결제 후 유료 기능을 사용해 청약철회 대상이 아닙니다(3플래그 참조). 그 외는 운영 보정으로 기록하세요.", 409);
    }
  }

  const stamp = now.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);

  const result = await prisma.$transaction(async (tx) => {
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
    const newStatus = refundedSoFar + amount >= locked.amt ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIALLY_REFUNDED;

    const refund = await tx.tbBlPayment.create({
      data: {
        sbscrptn_id:      locked.sbscrptn_id,
        mber_id:          locked.mber_id,
        pymnt_ty_code:    PAYMENT_TYPE.REFUND,
        amt:              -amount,
        seat_cnt:         locked.seat_cnt,
        perd_bgng_dt:     locked.perd_bgng_dt,
        perd_end_dt:      locked.perd_end_dt,
        pymnt_sttus_code: PAYMENT_STATUS.REFUNDED,
        pg_provdr_code:   locked.pg_provdr_code,
        pg_pymnt_key:     locked.pg_pymnt_key,
        pg_order_id:      `SPC-RF-${stamp}-${randomBytes(4).toString("hex").toUpperCase()}`,
        receipt_url:      locked.receipt_url,
        fail_rsn_cn:      input.memo,
        apprv_dt:         now,
        orig_pymnt_id:    locked.pymnt_id,
        refund_rsn_code:  input.reason,
        creat_dt:         now,
      },
    });
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

    await logAdminActionStrict(tx, {
      ...auditBase(actor), actionType: "BILLING_REFUND_RECORD", targetType: "PAYMENT", targetId: paymentId,
      memo: `[환불 기록 ${input.reason}] ${amount.toLocaleString("ko-KR")}원 / 원 결제 ${locked.amt.toLocaleString("ko-KR")}원 (${locked.pg_order_id}) → ${newStatus}${terminated ? " · 구독 종료(REFUND_WITHDRAWAL)" : ""} · ${input.memo}`,
    });
    return { refund, updatedOriginal, terminated, termination, sub };
  });

  if (result.terminated && result.sub && result.termination) {
    await sendTerminationNotice(result.sub, S.CANCELED, result.sub.member.email_addr, result.termination);
  }
  return { refund: toPaymentDto(result.refund), original: toPaymentDto(result.updatedOriginal), subscriptionTerminated: result.terminated };
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
