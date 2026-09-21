/**
 * billing/admin — 관리자 결제 화면용 조회·운영 액션 (SUPER_ADMIN 전용 라우트에서만 호출)
 *
 * 역할:
 *   조회  getBillingSummary · listSubscriptionsForAdmin · listPaymentsForAdmin(+export) · getSubscriptionDetailForAdmin
 *   액션  adminRetryCharge(즉시 재결제) · adminDeferBilling(다음 결제일 연기) · adminTerminate(강제 종료)
 *         adminRecordRefund(환불 기록) · adminUnlockProject(잠금 해제 대행) · listAdminAlertRecipients
 *
 * 원칙 (정책 §1-10):
 *   - 좌석·단가·플랜은 여기서 건드리지 않는다. 구독이 플랜의 원천이라 관리자가 값을 바꾸면 다음 결제 때
 *     다시 덮어써 더 헷갈린다. 보상은 "다음 결제일 연기"로만.
 *   - 액션은 기존 도메인 함수(attemptRecurringCharge·terminateSubscription·unlockProjectByOwner)를 그대로
 *     호출한다. 관리자 경로라고 규칙이 달라지면 안 된다. 감사 로그는 라우트가 남긴다.
 *   - 환불 실행은 PG 콘솔 수동(정책 §1-7). 여기서는 "했다"는 기록만 남겨 결제 이력과 대조가 가능하게 한다.
 */

import type { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getPaidFeatureUsage, type PaidFeatureUsage } from "./paidUsage";
import {
  BILLING_ERROR_CODES as E,
  isLiveSubscriptionStatus,
  LIVE_SUBSCRIPTION_STATUSES,
  PAYMENT_STATUS,
  PAYMENT_TYPE,
  SUBSCRIPTION_STATUS as S,
  type SubscriptionStatus,
} from "./constants";
import { BillingError } from "./errors";
import { getPaymentGateway } from "./gateway";
import { unlockProjectByOwner, type OverLimitVerdict } from "./lock";
import { addDays, monthlyAmount } from "./pricing";
import { countUsedSeats } from "./seats";
import {
  attemptRecurringCharge,
  terminateSubscription,
  toSubscriptionDto,
  type PaymentDto,
  type RecurringChargeResult,
  type SubscriptionDto,
} from "./subscription";
import { BILLING_DAILY_JOB_TYPE } from "./daily";

const DAY_MS = 24 * 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════════════
// 요약
// ═══════════════════════════════════════════════════════════════════════════

export type BillingSummary = {
  provider:             string;
  liveCount:            number;
  activeCount:          number;
  pastDueCount:         number;
  cancelScheduledCount: number;
  /** 살아 있는 구독의 구매 좌석 합 */
  seatTotal:            number;
  /** 다음 결제 예정 금액 합 (ACTIVE+PAST_DUE, 축소 예약 반영). 해지 예약은 제외 */
  monthlyExpectedAmount: number;
  /** 7일 안에 결제일이 오는 ACTIVE 구독 수 */
  dueWithin7Days:       number;
  /** 결제 잠금 프로젝트 수 */
  lockedProjectCount:   number;
  /** 최근 30일 결제 실패 건수 */
  failedPaymentsLast30d: number;
  /** 이번 달(KST) PAID 합계 — REFUND(음수) 포함 순액 */
  paidAmountThisMonth:  number;
  lastBatch: {
    jobId: string; status: string; startedAt: string; endedAt: string | null;
    targetCnt: number; successCnt: number; failCnt: number; skipCnt: number;
  } | null;
};

/** KST 이번 달 1일 00:00 */
function startOfKstMonth(now: Date): Date {
  const k = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 1) - 9 * 60 * 60 * 1000);
}

export async function getBillingSummary(now = new Date()): Promise<BillingSummary> {
  const [live, lockedProjectCount, failedPaymentsLast30d, paidAgg, lastBatch] = await Promise.all([
    prisma.tbBlSubscription.findMany({
      where:  { sbscrptn_sttus_code: { in: [...LIVE_SUBSCRIPTION_STATUSES] } },
      select: { sbscrptn_sttus_code: true, seat_cnt: true, pending_seat_cnt: true, unit_price: true, next_bill_dt: true },
    }),
    prisma.tbPjProject.count({ where: { del_yn: "N", lock_yn: "Y" } }),
    prisma.tbBlPayment.count({ where: { pymnt_sttus_code: PAYMENT_STATUS.FAILED, creat_dt: { gte: new Date(now.getTime() - 30 * DAY_MS) } } }),
    prisma.tbBlPayment.aggregate({
      _sum:  { amt: true },
      where: { pymnt_sttus_code: { in: [PAYMENT_STATUS.PAID, PAYMENT_STATUS.REFUNDED] }, pymnt_ty_code: { not: PAYMENT_TYPE.REFUND }, creat_dt: { gte: startOfKstMonth(now) } },
    }),
    prisma.tbCmBatchJob.findFirst({ where: { job_ty_code: BILLING_DAILY_JOB_TYPE }, orderBy: { bgng_dt: "desc" } }),
  ]);
  // 환불은 음수 행으로 따로 합산해 순액을 낸다
  const refundAgg = await prisma.tbBlPayment.aggregate({
    _sum:  { amt: true },
    where: { pymnt_ty_code: PAYMENT_TYPE.REFUND, creat_dt: { gte: startOfKstMonth(now) } },
  });

  const in7 = new Date(now.getTime() + 7 * DAY_MS);
  let activeCount = 0, pastDueCount = 0, cancelScheduledCount = 0, seatTotal = 0, monthlyExpectedAmount = 0, dueWithin7Days = 0;
  for (const s of live) {
    seatTotal += s.seat_cnt;
    if (s.sbscrptn_sttus_code === S.ACTIVE) {
      activeCount++;
      if (s.next_bill_dt && s.next_bill_dt <= in7) dueWithin7Days++;
    } else if (s.sbscrptn_sttus_code === S.PAST_DUE) pastDueCount++;
    else cancelScheduledCount++;
    if (s.sbscrptn_sttus_code !== S.CANCEL_SCHEDULED) {
      monthlyExpectedAmount += monthlyAmount(s.pending_seat_cnt ?? s.seat_cnt, s.unit_price);
    }
  }

  return {
    provider: getPaymentGateway().provider,
    liveCount: live.length, activeCount, pastDueCount, cancelScheduledCount,
    seatTotal, monthlyExpectedAmount, dueWithin7Days, lockedProjectCount, failedPaymentsLast30d,
    paidAmountThisMonth: (paidAgg._sum.amt ?? 0) + (refundAgg._sum.amt ?? 0),
    lastBatch: lastBatch ? {
      jobId: lastBatch.job_id, status: lastBatch.sttus_code, startedAt: lastBatch.bgng_dt.toISOString(),
      endedAt: lastBatch.end_dt?.toISOString() ?? null, targetCnt: lastBatch.trgt_cnt,
      successCnt: lastBatch.success_cnt, failCnt: lastBatch.fail_cnt, skipCnt: lastBatch.skip_cnt,
    } : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 구독 목록·상세
// ═══════════════════════════════════════════════════════════════════════════

export type AdminSubscriptionRow = SubscriptionDto & {
  member: { mberId: string; email: string | null; name: string | null; status: string; planCode: string };
  createdAt: string;
  updatedAt: string;
};

export type Pagination = { page: number; pageSize: number; totalCount: number; totalPages: number };

/** 상태 필터 — 개별 상태 코드 또는 "LIVE"(살아 있는 셋), 빈 값이면 전체 */
export async function listSubscriptionsForAdmin(q: {
  status?: string; search?: string; page: number; pageSize: number;
}): Promise<{ items: AdminSubscriptionRow[]; pagination: Pagination }> {
  const search = (q.search ?? "").trim().slice(0, 100);
  const where: Prisma.TbBlSubscriptionWhereInput = {
    ...(q.status === "LIVE"
      ? { sbscrptn_sttus_code: { in: [...LIVE_SUBSCRIPTION_STATUSES] } }
      : q.status ? { sbscrptn_sttus_code: q.status } : {}),
    ...(search
      ? { member: { OR: [
          { email_addr: { contains: search, mode: "insensitive" } },
          { mber_nm:    { contains: search, mode: "insensitive" } },
        ] } }
      : {}),
  };
  const [rows, totalCount] = await Promise.all([
    prisma.tbBlSubscription.findMany({
      where,
      include: { member: { select: { mber_id: true, email_addr: true, mber_nm: true, mber_sttus_code: true, plan_code: true } } },
      // 재시도 중(PAST_DUE)이 먼저 보이도록 상태 → 다음 결제일 순
      orderBy: [{ sbscrptn_sttus_code: "desc" }, { next_bill_dt: "asc" }, { mdfcn_dt: "desc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.tbBlSubscription.count({ where }),
  ]);
  return {
    items: rows.map((r) => ({
      ...toSubscriptionDto(r),
      member: { mberId: r.member.mber_id, email: r.member.email_addr, name: r.member.mber_nm, status: r.member.mber_sttus_code, planCode: r.member.plan_code },
      createdAt: r.creat_dt.toISOString(),
      updatedAt: r.mdfcn_dt.toISOString(),
    })),
    pagination: { page: q.page, pageSize: q.pageSize, totalCount, totalPages: Math.max(1, Math.ceil(totalCount / q.pageSize)) },
  };
}

export type AdminSubscriptionDetail = {
  subscription: AdminSubscriptionRow;
  usedSeats:    number;
  paidUsage:    PaidFeatureUsage;
  /** 소유 활성 프로젝트 — 잠금 상태·멤버 수 (잠금 해제 대행 판단용) */
  ownedProjects: Array<{ projectId: string; name: string; locked: boolean; lockedAt: string | null; memberCount: number; editorCount: number }>;
  payments:     PaymentDto[];
};

export async function getSubscriptionDetailForAdmin(sbscrptnId: string): Promise<AdminSubscriptionDetail | null> {
  const sub = await prisma.tbBlSubscription.findUnique({
    where:   { sbscrptn_id: sbscrptnId },
    include: { member: { select: { mber_id: true, email_addr: true, mber_nm: true, mber_sttus_code: true, plan_code: true } } },
  });
  if (!sub) return null;

  const [usedSeats, paidUsage, projects, payments] = await Promise.all([
    countUsedSeats(sub.mber_id),
    getPaidFeatureUsage(sub.mber_id),
    prisma.tbPjProject.findMany({
      where:   { owner_mber_id: sub.mber_id, del_yn: "N" },
      select:  { prjct_id: true, prjct_nm: true, lock_yn: true, lock_dt: true,
                 members: { where: { mber_sttus_code: "ACTIVE" }, select: { role_code: true } } },
      orderBy: { creat_dt: "asc" },
    }),
    prisma.tbBlPayment.findMany({ where: { mber_id: sub.mber_id }, orderBy: { creat_dt: "desc" }, take: 100 }),
  ]);

  return {
    subscription: {
      ...toSubscriptionDto(sub),
      member: { mberId: sub.member.mber_id, email: sub.member.email_addr, name: sub.member.mber_nm, status: sub.member.mber_sttus_code, planCode: sub.member.plan_code },
      createdAt: sub.creat_dt.toISOString(),
      updatedAt: sub.mdfcn_dt.toISOString(),
    },
    usedSeats,
    paidUsage,
    ownedProjects: projects.map((p) => ({
      projectId: p.prjct_id, name: p.prjct_nm, locked: p.lock_yn === "Y", lockedAt: p.lock_dt?.toISOString() ?? null,
      memberCount: p.members.length,
      editorCount: p.members.filter((m) => m.role_code !== "VIEWER").length,
    })),
    payments: payments.map(toPaymentDto),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 결제 이력 (전체)
// ═══════════════════════════════════════════════════════════════════════════

export type AdminPaymentRow = PaymentDto & {
  member: { mberId: string; email: string | null; name: string | null };
  provider: string;
  paymentKey: string | null;
};

export type PaymentFilters = {
  from?: Date; to?: Date; status?: string; type?: string; search?: string;
};

function paymentWhere(f: PaymentFilters, memberIds: string[] | null): Prisma.TbBlPaymentWhereInput {
  return {
    ...(f.status ? { pymnt_sttus_code: f.status } : {}),
    ...(f.type   ? { pymnt_ty_code: f.type } : {}),
    ...(f.from || f.to ? { creat_dt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
    ...(memberIds ? { mber_id: { in: memberIds } } : {}),
  };
}

/** 이메일·이름 검색 → 회원 ID 목록 (결제 이력 표에는 회원 관계가 없어 두 단계로) */
async function resolveMemberIds(search: string | undefined): Promise<string[] | null> {
  const s = (search ?? "").trim().slice(0, 100);
  if (!s) return null;
  const members = await prisma.tbCmMember.findMany({
    where:  { OR: [{ email_addr: { contains: s, mode: "insensitive" } }, { mber_nm: { contains: s, mode: "insensitive" } }] },
    select: { mber_id: true },
    take:   500,
  });
  return members.map((m) => m.mber_id);
}

async function attachMembers(rows: Array<{ mber_id: string }>): Promise<Map<string, { email: string | null; name: string | null }>> {
  const ids = [...new Set(rows.map((r) => r.mber_id))];
  if (ids.length === 0) return new Map();
  const members = await prisma.tbCmMember.findMany({ where: { mber_id: { in: ids } }, select: { mber_id: true, email_addr: true, mber_nm: true } });
  return new Map(members.map((m) => [m.mber_id, { email: m.email_addr, name: m.mber_nm }]));
}

export async function listPaymentsForAdmin(f: PaymentFilters & { page: number; pageSize: number }): Promise<{ items: AdminPaymentRow[]; pagination: Pagination; sumAmount: number }> {
  const memberIds = await resolveMemberIds(f.search);
  const where = paymentWhere(f, memberIds);
  const [rows, totalCount, agg] = await Promise.all([
    prisma.tbBlPayment.findMany({ where, orderBy: { creat_dt: "desc" }, skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
    prisma.tbBlPayment.count({ where }),
    prisma.tbBlPayment.aggregate({ _sum: { amt: true }, where: { ...where, pymnt_sttus_code: { in: [PAYMENT_STATUS.PAID, PAYMENT_STATUS.REFUNDED] } } }),
  ]);
  const members = await attachMembers(rows);
  return {
    items: rows.map((p) => toAdminPaymentRow(p, members)),
    pagination: { page: f.page, pageSize: f.pageSize, totalCount, totalPages: Math.max(1, Math.ceil(totalCount / f.pageSize)) },
    sumAmount: agg._sum.amt ?? 0,
  };
}

/** 엑셀 내보내기 — 필터 그대로 전량. 호출자가 MAX_EXPORT_ROWS 로 자른다 */
export async function fetchPaymentsForExport(f: PaymentFilters, limit: number): Promise<AdminPaymentRow[]> {
  const memberIds = await resolveMemberIds(f.search);
  const rows = await prisma.tbBlPayment.findMany({ where: paymentWhere(f, memberIds), orderBy: { creat_dt: "desc" }, take: limit });
  const members = await attachMembers(rows);
  return rows.map((p) => toAdminPaymentRow(p, members));
}

type PaymentRecord = Prisma.TbBlPaymentGetPayload<Record<string, never>>;

function toPaymentDto(p: PaymentRecord): PaymentDto {
  return {
    paymentId: p.pymnt_id, type: p.pymnt_ty_code as PaymentDto["type"], status: p.pymnt_sttus_code, amount: p.amt, seatCnt: p.seat_cnt,
    periodStart: p.perd_bgng_dt?.toISOString() ?? null, periodEnd: p.perd_end_dt?.toISOString() ?? null,
    receiptUrl: p.receipt_url, failReason: p.fail_rsn_cn, orderId: p.pg_order_id,
    approvedAt: p.apprv_dt?.toISOString() ?? null, createdAt: p.creat_dt.toISOString(),
  };
}

function toAdminPaymentRow(p: PaymentRecord, members: Map<string, { email: string | null; name: string | null }>): AdminPaymentRow {
  const m = members.get(p.mber_id);
  return { ...toPaymentDto(p), member: { mberId: p.mber_id, email: m?.email ?? null, name: m?.name ?? null }, provider: p.pg_provdr_code, paymentKey: p.pg_pymnt_key };
}

// ═══════════════════════════════════════════════════════════════════════════
// 운영 액션
// ═══════════════════════════════════════════════════════════════════════════

async function requireSub(sbscrptnId: string) {
  const sub = await prisma.tbBlSubscription.findUnique({
    where: { sbscrptn_id: sbscrptnId },
    include: { member: { select: { email_addr: true } } },
  });
  if (!sub) throw new BillingError(E.NO_SUBSCRIPTION, "구독을 찾을 수 없습니다.", 404);
  return sub;
}

/** 즉시 재결제 — PAST_DUE 에서만. "카드 고쳤어요" 민원 시 3일을 기다리지 않게 */
export async function adminRetryCharge(sbscrptnId: string, now = new Date()): Promise<RecurringChargeResult> {
  const sub = await requireSub(sbscrptnId);
  if (sub.sbscrptn_sttus_code !== S.PAST_DUE) {
    throw new BillingError(E.INVALID_STATE, "재시도 중(PAST_DUE) 구독에서만 즉시 재결제할 수 있습니다.", 409);
  }
  return attemptRecurringCharge(sub, sub.member.email_addr ?? "", now, "RETRY");
}

export const DEFER_DAYS_LIMITS = { min: 1, max: 90 } as const;

/**
 * 다음 결제일 연기 — 장애 보상·민원 처리용. ACTIVE 에서만.
 * 현재 주기 종료·다음 결제일을 N일 뒤로 밀고, 사전 안내는 새 날짜 기준으로 다시 나가게 리셋한다.
 * 좌석·단가는 그대로 — 무상 이용 기간이 늘어나는 것뿐.
 */
export async function adminDeferBilling(sbscrptnId: string, days: number, now = new Date()): Promise<SubscriptionDto> {
  if (!Number.isInteger(days) || days < DEFER_DAYS_LIMITS.min || days > DEFER_DAYS_LIMITS.max) {
    throw new BillingError(E.INVALID_STATE, `연기 일수는 ${DEFER_DAYS_LIMITS.min}~${DEFER_DAYS_LIMITS.max}일이어야 합니다.`, 400);
  }
  const sub = await requireSub(sbscrptnId);
  if (sub.sbscrptn_sttus_code !== S.ACTIVE || !sub.crrnt_perd_end_dt || !sub.next_bill_dt) {
    throw new BillingError(E.INVALID_STATE, "이용 중(ACTIVE) 구독에서만 결제일을 연기할 수 있습니다.", 409);
  }
  const updated = await prisma.tbBlSubscription.update({
    where: { sbscrptn_id: sbscrptnId },
    data: {
      crrnt_perd_end_dt: addDays(sub.crrnt_perd_end_dt, days),
      next_bill_dt:      addDays(sub.next_bill_dt, days),
      prentc_dt:         null,
      mdfcn_dt:          now,
    },
  });
  return toSubscriptionDto(updated);
}

/** 강제 종료 — 운영 사유. 해지 확정과 같은 경로(CANCELED·FREE·잠금·메일) */
export async function adminTerminate(sbscrptnId: string, now = new Date()): Promise<SubscriptionDto> {
  const sub = await requireSub(sbscrptnId);
  if (!isLiveSubscriptionStatus(sub.sbscrptn_sttus_code)) {
    throw new BillingError(E.INVALID_STATE, "이미 종료된 구독입니다.", 409);
  }
  await terminateSubscription(sub, S.CANCELED, now, sub.member.email_addr);
  return toSubscriptionDto((await requireSub(sbscrptnId)));
}

/**
 * 환불 기록 — PG 콘솔에서 취소한 뒤 여기서 이력만 남긴다.
 * REFUND 행(음수 금액) 추가 + 원 결제 행을 REFUNDED 로. 부분 환불도 원 결제는 REFUNDED 로 표시하고
 * 금액은 REFUND 행에서 읽는다(합계는 순액으로 맞는다).
 */
export async function adminRecordRefund(paymentId: string, amount: number, reason: string, now = new Date()): Promise<{ refund: PaymentDto; original: PaymentDto }> {
  const original = await prisma.tbBlPayment.findUnique({ where: { pymnt_id: paymentId } });
  if (!original) throw new BillingError(E.INVALID_STATE, "결제 건을 찾을 수 없습니다.", 404);
  if (original.pymnt_ty_code === PAYMENT_TYPE.REFUND || original.pymnt_sttus_code !== PAYMENT_STATUS.PAID) {
    throw new BillingError(E.INVALID_STATE, "결제 완료(PAID) 상태의 결제 건만 환불 기록할 수 있습니다.", 409);
  }
  if (!Number.isInteger(amount) || amount < 1 || amount > original.amt) {
    throw new BillingError(E.INVALID_STATE, `환불 금액은 1원 이상, 결제 금액(${original.amt.toLocaleString("ko-KR")}원) 이하여야 합니다.`, 400);
  }
  const stamp = now.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const [refund, updatedOriginal] = await prisma.$transaction([
    prisma.tbBlPayment.create({
      data: {
        sbscrptn_id:      original.sbscrptn_id,
        mber_id:          original.mber_id,
        pymnt_ty_code:    PAYMENT_TYPE.REFUND,
        amt:              -amount,
        seat_cnt:         original.seat_cnt,
        perd_bgng_dt:     original.perd_bgng_dt,
        perd_end_dt:      original.perd_end_dt,
        pymnt_sttus_code: PAYMENT_STATUS.REFUNDED,
        pg_provdr_code:   original.pg_provdr_code,
        pg_pymnt_key:     original.pg_pymnt_key,
        pg_order_id:      `SPC-RF-${stamp}-${randomBytes(4).toString("hex").toUpperCase()}`,
        receipt_url:      original.receipt_url,
        fail_rsn_cn:      `환불(원 주문 ${original.pg_order_id}): ${reason}`,
        apprv_dt:         now,
        creat_dt:         now,
      },
    }),
    prisma.tbBlPayment.update({ where: { pymnt_id: paymentId }, data: { pymnt_sttus_code: PAYMENT_STATUS.REFUNDED } }),
  ]);
  return { refund: toPaymentDto(refund), original: toPaymentDto(updatedOriginal) };
}

export type AdminUnlockResult =
  | { unlocked: true; forced: boolean }
  | { unlocked: false; verdict: Extract<OverLimitVerdict, { over: true }> };

/**
 * 잠금 해제 대행 — 기본은 소유자 "활성화"와 같은 판정. force 면 상한 초과여도 풀어 준다
 * (소유자 연락 불가·운영 판단). force 사유는 라우트가 감사 로그에 남긴다.
 */
export async function adminUnlockProject(projectId: string, force: boolean): Promise<AdminUnlockResult> {
  const project = await prisma.tbPjProject.findUnique({ where: { prjct_id: projectId }, select: { del_yn: true, lock_yn: true } });
  if (!project || project.del_yn === "Y") throw new BillingError(E.INVALID_STATE, "프로젝트를 찾을 수 없습니다.", 404);
  if (project.lock_yn !== "Y") return { unlocked: true, forced: false };

  const r = await unlockProjectByOwner(projectId);
  if (r.unlocked) return { unlocked: true, forced: false };
  if (!force) return { unlocked: false, verdict: r.verdict };

  await prisma.tbPjProject.update({ where: { prjct_id: projectId }, data: { lock_yn: "N", lock_dt: null } });
  return { unlocked: true, forced: true };
}

/** 관리자 알림 수신자 — 활성 SUPER_ADMIN 의 이메일 */
export async function listAdminAlertRecipients(): Promise<string[]> {
  const admins = await prisma.tbCmMember.findMany({
    where:  { sys_role_code: "SUPER_ADMIN", mber_sttus_code: "ACTIVE", email_addr: { not: null } },
    select: { email_addr: true },
  });
  return admins.map((a) => a.email_addr!).filter(Boolean);
}

export type { SubscriptionStatus };
