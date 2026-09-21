/**
 * billing/admin-queries — 관리자 결제 화면 조회 (SUPER_ADMIN 전용 라우트에서만 호출)
 *
 *   getBillingSummary            요약 카드
 *   listSubscriptionsForAdmin    구독 목록 (상태 필터·회원 검색)
 *   getSubscriptionDetailForAdmin 구독 상세 (회원·사용 좌석·환불 3플래그·소유 프로젝트·결제 이력·환불 잔액)
 *   listPaymentsForAdmin / fetchPaymentsForExport  결제 이력 (필터·순액·엑셀)
 *   listAdminAlertRecipients     관리자 알림 수신자
 *
 * 운영 액션은 admin-actions.ts. 두 파일로 나눈 이유: 300줄 규칙(기술규칙 §7-⑤) + 조회는 부작용이 없어
 * 검토 범위를 나누기 위해.
 */

import type { Prisma, TbBlPayment } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPaidFeatureUsage, type PaidFeatureUsage } from "./paidUsage";
import {
  LIVE_SUBSCRIPTION_STATUSES,
  PAYMENT_STATUS,
  PAYMENT_TYPE,
  SUBSCRIPTION_STATUS as S,
} from "./constants";
import { getPaymentGateway } from "./gateway";
import { monthlyAmount } from "./pricing";
import { countUsedSeats } from "./seats";
import { toPaymentDto, toSubscriptionDto, type PaymentDto, type SubscriptionDto } from "./subscription";
import { BILLING_DAILY_JOB_TYPE } from "./daily";

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_MS = 9 * 60 * 60 * 1000;

export type Pagination = { page: number; pageSize: number; totalCount: number; totalPages: number };

function paginate(page: number, pageSize: number, totalCount: number): Pagination {
  return { page, pageSize, totalCount, totalPages: Math.max(1, Math.ceil(totalCount / pageSize)) };
}

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
  lockedProjectCount:   number;
  /** 최근 30일 결제 실패 건수 (시도 시각 기준) */
  failedPaymentsLast30d: number;
  /** 이번 달(KST) 승인 순액 = 승인된 결제 − 승인된 환불. 회계 매출 인식·부가세·PG 수수료 미반영 */
  approvedNetThisMonth: number;
  lastBatch: {
    jobId: string; status: string; startedAt: string; endedAt: string | null;
    targetCnt: number; successCnt: number; failCnt: number; skipCnt: number;
  } | null;
};

/** KST 이번 달 [1일 00:00, 다음 달 1일 00:00) */
export function kstMonthRange(now: Date): { start: Date; end: Date } {
  const k = new Date(now.getTime() + KST_MS);
  const y = k.getUTCFullYear(), m = k.getUTCMonth();
  return { start: new Date(Date.UTC(y, m, 1) - KST_MS), end: new Date(Date.UTC(y, m + 1, 1) - KST_MS) };
}

export async function getBillingSummary(now = new Date()): Promise<BillingSummary> {
  const month = kstMonthRange(now);
  const [live, lockedProjectCount, failedPaymentsLast30d, approvedAgg, lastBatch] = await Promise.all([
    prisma.tbBlSubscription.findMany({
      where:  { sbscrptn_sttus_code: { in: [...LIVE_SUBSCRIPTION_STATUSES] } },
      select: { sbscrptn_sttus_code: true, seat_cnt: true, pending_seat_cnt: true, unit_price: true, next_bill_dt: true },
    }),
    prisma.tbPjProject.count({ where: { del_yn: "N", lock_yn: "Y" } }),
    prisma.tbBlPayment.count({ where: { pymnt_sttus_code: PAYMENT_STATUS.FAILED, creat_dt: { gte: new Date(now.getTime() - 30 * DAY_MS) } } }),
    // 승인 시각 기준. 결제(양수)와 환불(음수) 행을 같은 조건으로 더하면 순액이 된다. FAILED 는 apprv_dt 가 없어 자연히 제외
    prisma.tbBlPayment.aggregate({ _sum: { amt: true }, where: { apprv_dt: { gte: month.start, lt: month.end } } }),
    prisma.tbCmBatchJob.findFirst({ where: { job_ty_code: BILLING_DAILY_JOB_TYPE }, orderBy: { bgng_dt: "desc" } }),
  ]);

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
    approvedNetThisMonth: approvedAgg._sum.amt ?? 0,
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

type SubWithMember = Prisma.TbBlSubscriptionGetPayload<{ include: { member: { select: { mber_id: true; email_addr: true; mber_nm: true; mber_sttus_code: true; plan_code: true } } } }>;
const MEMBER_SELECT = { mber_id: true, email_addr: true, mber_nm: true, mber_sttus_code: true, plan_code: true } as const;

function toAdminRow(r: SubWithMember, now: Date): AdminSubscriptionRow {
  return {
    ...toSubscriptionDto(r, now),
    member: { mberId: r.member.mber_id, email: r.member.email_addr, name: r.member.mber_nm, status: r.member.mber_sttus_code, planCode: r.member.plan_code },
    createdAt: r.creat_dt.toISOString(),
    updatedAt: r.mdfcn_dt.toISOString(),
  };
}

/** 상태 필터 — 개별 상태 코드 또는 "LIVE"(살아 있는 셋), 빈 값이면 전체 */
export async function listSubscriptionsForAdmin(q: {
  status?: string; search?: string; page: number; pageSize: number;
}, now = new Date()): Promise<{ items: AdminSubscriptionRow[]; pagination: Pagination }> {
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
      include: { member: { select: MEMBER_SELECT } },
      // 재시도 중(PAST_DUE)이 먼저 보이도록 상태 → 다음 결제일 순
      orderBy: [{ sbscrptn_sttus_code: "desc" }, { next_bill_dt: "asc" }, { mdfcn_dt: "desc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.tbBlSubscription.count({ where }),
  ]);
  return { items: rows.map((r) => toAdminRow(r, now)), pagination: paginate(q.page, q.pageSize, totalCount) };
}

/** 결제 이력 + 환불 잔액 — 원 결제(PAID/PARTIALLY_REFUNDED)에는 누적 환불액·잔액이 붙는다 */
export type AdminPaymentDetailRow = PaymentDto & {
  refundedAmount:   number;
  refundableAmount: number;
};

export type AdminSubscriptionDetail = {
  subscription: AdminSubscriptionRow;
  usedSeats:    number;
  paidUsage:    PaidFeatureUsage;
  /** 소유 활성 프로젝트 — 잠금 상태·멤버 수 (잠금 해제 대행 판단용) */
  ownedProjects: Array<{ projectId: string; name: string; locked: boolean; lockedAt: string | null; memberCount: number; editorCount: number }>;
  payments:     AdminPaymentDetailRow[];
};

/** 원 결제별 누적 환불액 (REFUND 행의 amt 는 음수 → 부호 반전해 합산) */
export async function refundedAmountByOriginal(
  paymentIds: string[],
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Map<string, number>> {
  if (paymentIds.length === 0) return new Map();
  const grouped = await db.tbBlPayment.groupBy({
    by:    ["orig_pymnt_id"],
    where: { orig_pymnt_id: { in: paymentIds }, pymnt_ty_code: PAYMENT_TYPE.REFUND },
    _sum:  { amt: true },
  });
  return new Map(grouped.filter((g) => g.orig_pymnt_id).map((g) => [g.orig_pymnt_id!, -(g._sum.amt ?? 0)]));
}

function withRefundBalance(p: TbBlPayment, refunded: Map<string, number>): AdminPaymentDetailRow {
  const dto = toPaymentDto(p);
  const isOriginal = p.pymnt_ty_code !== PAYMENT_TYPE.REFUND && p.pymnt_sttus_code !== PAYMENT_STATUS.FAILED;
  const refundedAmount = isOriginal ? (refunded.get(p.pymnt_id) ?? 0) : 0;
  return { ...dto, refundedAmount, refundableAmount: isOriginal ? Math.max(0, p.amt - refundedAmount) : 0 };
}

export async function getSubscriptionDetailForAdmin(sbscrptnId: string, now = new Date()): Promise<AdminSubscriptionDetail | null> {
  const sub = await prisma.tbBlSubscription.findUnique({
    where:   { sbscrptn_id: sbscrptnId },
    include: { member: { select: MEMBER_SELECT } },
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
  const refunded = await refundedAmountByOriginal(payments.map((p) => p.pymnt_id));

  return {
    subscription: toAdminRow(sub, now),
    usedSeats,
    paidUsage,
    ownedProjects: projects.map((p) => ({
      projectId: p.prjct_id, name: p.prjct_nm, locked: p.lock_yn === "Y", lockedAt: p.lock_dt?.toISOString() ?? null,
      memberCount: p.members.length,
      editorCount: p.members.filter((m) => m.role_code !== "VIEWER").length,
    })),
    payments: payments.map((p) => withRefundBalance(p, refunded)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 결제 이력 (전체)
// ═══════════════════════════════════════════════════════════════════════════

export type AdminPaymentRow = PaymentDto & {
  member:     { mberId: string; email: string | null; name: string | null };
  provider:   string;
  paymentKey: string | null;
};

export type PaymentFilters = {
  from?: Date; to?: Date; status?: string; type?: string; search?: string;
};

/** 회원 검색이 이 수를 넘으면 결과가 잘린다 — 응답에 truncated 로 알린다 */
const MEMBER_SEARCH_LIMIT = 500;

function paymentWhere(f: PaymentFilters, memberIds: string[] | null): Prisma.TbBlPaymentWhereInput {
  return {
    ...(f.status ? { pymnt_sttus_code: f.status } : {}),
    ...(f.type   ? { pymnt_ty_code: f.type } : {}),
    ...(f.from || f.to ? { creat_dt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
    ...(memberIds ? { mber_id: { in: memberIds } } : {}),
  };
}

/** 이메일·이름 검색 → 회원 ID 목록 (결제 이력 표에는 회원 관계가 없어 두 단계로). null = 검색 없음 */
async function resolveMemberIds(search: string | undefined): Promise<{ ids: string[]; truncated: boolean } | null> {
  const s = (search ?? "").trim().slice(0, 100);
  if (!s) return null;
  const members = await prisma.tbCmMember.findMany({
    where:  { OR: [{ email_addr: { contains: s, mode: "insensitive" } }, { mber_nm: { contains: s, mode: "insensitive" } }] },
    select: { mber_id: true },
    take:   MEMBER_SEARCH_LIMIT + 1,
  });
  return { ids: members.slice(0, MEMBER_SEARCH_LIMIT).map((m) => m.mber_id), truncated: members.length > MEMBER_SEARCH_LIMIT };
}

async function attachMembers(rows: Array<{ mber_id: string }>): Promise<Map<string, { email: string | null; name: string | null }>> {
  const ids = [...new Set(rows.map((r) => r.mber_id))];
  if (ids.length === 0) return new Map();
  const members = await prisma.tbCmMember.findMany({ where: { mber_id: { in: ids } }, select: { mber_id: true, email_addr: true, mber_nm: true } });
  return new Map(members.map((m) => [m.mber_id, { email: m.email_addr, name: m.mber_nm }]));
}

function toAdminPaymentRow(p: TbBlPayment, members: Map<string, { email: string | null; name: string | null }>): AdminPaymentRow {
  const m = members.get(p.mber_id);
  return { ...toPaymentDto(p), member: { mberId: p.mber_id, email: m?.email ?? null, name: m?.name ?? null }, provider: p.pg_provdr_code, paymentKey: p.pg_pymnt_key };
}

export async function listPaymentsForAdmin(f: PaymentFilters & { page: number; pageSize: number }): Promise<{
  items: AdminPaymentRow[]; pagination: Pagination;
  /** 필터 범위의 승인 순액 (결제 + 음수 환불). 실패 건은 apprv_dt 없어 제외 */
  sumAmount: number;
  /** 회원 검색이 상한(500명)을 넘어 일부만 반영됨 */
  searchTruncated: boolean;
}> {
  const resolved = await resolveMemberIds(f.search);
  const where = paymentWhere(f, resolved?.ids ?? null);
  const [rows, totalCount, agg] = await Promise.all([
    prisma.tbBlPayment.findMany({ where, orderBy: { creat_dt: "desc" }, skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
    prisma.tbBlPayment.count({ where }),
    prisma.tbBlPayment.aggregate({ _sum: { amt: true }, where: { ...where, apprv_dt: { not: null } } }),
  ]);
  const members = await attachMembers(rows);
  return {
    items: rows.map((p) => toAdminPaymentRow(p, members)),
    pagination: paginate(f.page, f.pageSize, totalCount),
    sumAmount: agg._sum.amt ?? 0,
    searchTruncated: resolved?.truncated ?? false,
  };
}

/** 엑셀 내보내기 — 필터 그대로 전량. 호출자가 MAX_EXPORT_ROWS 로 자른다 */
export async function fetchPaymentsForExport(f: PaymentFilters, limit: number): Promise<AdminPaymentRow[]> {
  const resolved = await resolveMemberIds(f.search);
  const rows = await prisma.tbBlPayment.findMany({ where: paymentWhere(f, resolved?.ids ?? null), orderBy: { creat_dt: "desc" }, take: limit });
  const members = await attachMembers(rows);
  return rows.map((p) => toAdminPaymentRow(p, members));
}

// ═══════════════════════════════════════════════════════════════════════════
// 알림
// ═══════════════════════════════════════════════════════════════════════════

/** 관리자 알림 수신자 — 활성 SUPER_ADMIN 의 이메일 */
export async function listAdminAlertRecipients(): Promise<string[]> {
  const admins = await prisma.tbCmMember.findMany({
    where:  { sys_role_code: "SUPER_ADMIN", mber_sttus_code: "ACTIVE", email_addr: { not: null } },
    select: { email_addr: true },
  });
  return admins.map((a) => a.email_addr!).filter(Boolean);
}
