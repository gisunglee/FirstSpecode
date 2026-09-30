/**
 * billing/daily — 일일 청구 배치 본체 (라우트 /api/admin/batch/run/billing-daily 가 호출)
 *
 * 하루 1회, 살아 있는 구독(ACTIVE / PAST_DUE / CANCEL_SCHEDULED) 하나마다 순서대로:
 *   ① CANCEL_SCHEDULED 이고 주기가 끝났으면      → CANCELED · FREE · 잠금 · 메일
 *   ② ACTIVE 이고 next_bill_dt 가 지났으면       → 정기 결제 (축소 예약 적용). 실패 → PAST_DUE
 *   ③ PAST_DUE 이고 마지막 실패 + 3일이 지났으면 → 재시도. 소진 → EXPIRED · FREE · 잠금 · 메일
 *   ④ ACTIVE 이고 결제 7일 전이 지났고 아직 안 보냈으면 → 사전 안내 메일 (prentc_dt 기록)
 *
 * 구독과 별개로, 관리자가 수동 부여한 플랜(구독 행 없음)도 하루 1회 정리한다:
 *   ⑤ plan_expire_dt 가 지난 유료 회원 → FREE 확정 · 소유 프로젝트 잠금 · 메일 (processExpiredManualPlans)
 *      구독 행이 없어 ①~④ 대상에 들어오지 않으므로 별도 단계가 필요하다.
 *   ⑥ 10분 넘게 PENDING 인 결제 시도 → PG 주문 조회로 확정 (resolvePendingPayments, 2026-09-30 라이브 전 필수 ①)
 *      "PG 승인 · 우리 DB 미반영"은 자동결제 웹훅이 오지 않아(토스) 이 조회로만 잡힌다. 확정 못 하면 관리자 알림.
 *
 * 멱등성: 같은 날 두 번 돌아도 ①~③은 상태 전이로, ④는 prentc_dt 로 중복 실행되지 않는다.
 * `now` 를 인자로 받는 이유: 스모크 테스트(scripts/billing-flow-db-smoke.ts)가 날짜를 앞으로
 * 돌려 한 달 뒤·재시도 3회·강등까지 실제 코드로 검증하기 위해. 라우트는 항상 현재 시각을 넘긴다.
 */

import { prisma } from "@/lib/prisma";
import {
  ENDED_REASON,
  isLiveSubscriptionStatus,
  LIVE_SUBSCRIPTION_STATUSES,
  PRENOTICE_DAYS,
  PRODUCTS,
  RETRY_POLICY,
  SUBSCRIPTION_STATUS as S,
} from "./constants";
import { sendDowngradedEmail, sendUpcomingChargeEmail } from "./emails";
import { addDays, monthlyAmount } from "./pricing";
import { attemptRecurringCharge, loadStalePendingMembers, resolvePendingPayments, terminateSubscription } from "./subscription";
import { countLockedProjects, syncLockForManualPlan } from "./lock";
import { SPECODE_PRODUCT } from "./constants";

export const BILLING_DAILY_JOB_TYPE = "BILLING_DAILY";

export type DailyAction =
  | "CANCEL_FINALIZED"
  | "RENEWED"
  | "RENEW_FAILED"
  | "RETRY_SUCCEEDED"
  | "RETRY_FAILED"
  | "EXPIRED"
  | "PRENOTICE_SENT"
  /** 청구 결과 불명 — PENDING 으로 남김. 관리자 알림 대상 */
  | "CHARGE_UNKNOWN";

export type DailyTarget = {
  sbscrptnId: string;
  mberId:     string;
  email:      string | null;
  status:     string;
};

/** 처리 대상 — 종료되지 않은 구독 전부 (규모가 작아 상태별 필터 없이 훑고, 각자 할 일이 없으면 SKIPPED) */
export async function loadDailyTargets(): Promise<DailyTarget[]> {
  const rows = await prisma.tbBlSubscription.findMany({
    where:   { sbscrptn_sttus_code: { in: [...LIVE_SUBSCRIPTION_STATUSES] } },
    select:  { sbscrptn_id: true, mber_id: true, sbscrptn_sttus_code: true, member: { select: { email_addr: true } } },
    orderBy: { next_bill_dt: "asc" },
  });
  return rows.map((r) => ({
    sbscrptnId: r.sbscrptn_id,
    mberId:     r.mber_id,
    email:      r.member.email_addr,
    status:     r.sbscrptn_sttus_code,
  }));
}

/** 구독 1건 처리 — 수행한 동작 목록 반환 (비어 있으면 오늘 할 일 없음) */
export async function processSubscriptionDaily(sbscrptnId: string, now: Date): Promise<DailyAction[]> {
  const actions: DailyAction[] = [];

  let sub = await prisma.tbBlSubscription.findUnique({
    where:   { sbscrptn_id: sbscrptnId },
    include: { member: { select: { email_addr: true } } },
  });
  if (!sub || !isLiveSubscriptionStatus(sub.sbscrptn_sttus_code)) return actions;
  const email = sub.member.email_addr ?? "";

  // ① 해지 예약 — 주기 종료 시 확정
  if (sub.sbscrptn_sttus_code === S.CANCEL_SCHEDULED) {
    if (sub.crrnt_perd_end_dt && sub.crrnt_perd_end_dt <= now) {
      await terminateSubscription(sub, S.CANCELED, now, email || null, ENDED_REASON.USER_CANCEL);
      actions.push("CANCEL_FINALIZED");
    }
    return actions;  // 해지 예정 구독은 청구·사전 안내 대상이 아니다
  }

  // ② 정기 결제
  if (sub.sbscrptn_sttus_code === S.ACTIVE && sub.next_bill_dt && sub.next_bill_dt <= now) {
    const r = await attemptRecurringCharge(sub, email, now, "RENEWAL");
    if (!r.ok && r.skipped) {
      // 다른 처리가 선점 — 오늘은 건너뛴다(다음 실행에 다시 판정). 결과 불명은 관리자에게 알린다
      if (r.unknown) actions.push("CHARGE_UNKNOWN");
      return actions;
    }
    actions.push(r.ok ? "RENEWED" : r.expired ? "EXPIRED" : "RENEW_FAILED");
    if (!r.ok) return actions;
    sub = await refetch(sbscrptnId);
    if (!sub) return actions;
  }

  // ③ 재시도 (3일 간격)
  if (sub.sbscrptn_sttus_code === S.PAST_DUE) {
    const due = sub.last_fail_dt ? addDays(sub.last_fail_dt, RETRY_POLICY.intervalDays) : now;
    if (due <= now) {
      const r = await attemptRecurringCharge(sub, email, now, "RETRY");
      if (!r.ok && r.skipped) {
        if (r.unknown) actions.push("CHARGE_UNKNOWN");
        return actions;
      }
      actions.push(r.ok ? "RETRY_SUCCEEDED" : r.expired ? "EXPIRED" : "RETRY_FAILED");
      if (!r.ok) return actions;
      sub = await refetch(sbscrptnId);
      if (!sub) return actions;
    } else {
      return actions;
    }
  }

  // ④ 결제 7일 전 사전 안내 — 이번 주기에 아직 안 보냈고, 결제일이 아직 오지 않았을 때
  if (
    sub.sbscrptn_sttus_code === S.ACTIVE &&
    sub.next_bill_dt &&
    !sub.prentc_dt &&
    addDays(sub.next_bill_dt, -PRENOTICE_DAYS) <= now &&
    sub.next_bill_dt > now &&
    email
  ) {
    const seatCnt = sub.pending_seat_cnt ?? sub.seat_cnt;
    // 발송이 성공했을 때만 발송 시각을 기록한다 — 먼저 기록하면 SMTP 장애 때 안내가 영영 나가지 않는다.
    // 하루 1회 배치라 실패 시 다음 날 다시 시도되고, 결제일 전이면 그때 나간다.
    const sent = await sendUpcomingChargeEmail({
      to:          email,
      productName: PRODUCTS[sub.prdct_code as keyof typeof PRODUCTS]?.name ?? sub.prdct_code,
      amount:      monthlyAmount(seatCnt, sub.unit_price),
      seatCnt,
      billAt:      sub.next_bill_dt,
      cardLabel:   sub.card_co_nm && sub.card_no_masked ? `${sub.card_co_nm} ${sub.card_no_masked}` : null,
    });
    if (sent) {
      await prisma.tbBlSubscription.update({
        where: { sbscrptn_id: sub.sbscrptn_id },
        data:  { prentc_dt: now },
      });
      actions.push("PRENOTICE_SENT");
    }
  }

  return actions;
}

async function refetch(sbscrptnId: string) {
  return prisma.tbBlSubscription.findUnique({
    where:   { sbscrptn_id: sbscrptnId },
    include: { member: { select: { email_addr: true } } },
  });
}

// ─── ⑤ 관리자 수동 부여 플랜 만료 정리 ───────────────────────────────────────

export type ManualPlanTarget = {
  mberId: string;
  email:  string | null;
  plan:   string;
};

/**
 * 만료된 수동 부여 플랜 대상 — plan_expire_dt 가 지난 유료 회원 중 살아 있는 구독이 없는 사람.
 *
 *   - 구독이 있으면 구독이 플랜의 원천이라 ①②③이 처리한다(중복 강등 방지).
 *   - SUPER_ADMIN 은 실효 플랜이 항상 ENTERPRISE 라 만료 개념이 없다 — 운영자가 자기 계정을
 *     잠가 손발이 묶이는 사고를 막는다.
 */
export async function loadExpiredManualPlanTargets(now: Date): Promise<ManualPlanTarget[]> {
  const rows = await prisma.tbCmMember.findMany({
    where: {
      mber_sttus_code: "ACTIVE",
      plan_code:       { not: "FREE" },
      // NULL 은 lte 를 만족하지 않으므로 "만료일이 설정돼 있고 지난" 회원만 잡힌다(무기한 제외)
      plan_expire_dt:  { lte: now },
      // sys_role_code 는 nullable — `{ not: "SUPER_ADMIN" }` 만 쓰면 일반 회원(NULL)까지 함께
      // 걸러진다(SQL 에서 NULL <> 'X' 가 NULL 로 평가). NULL 을 명시적으로 포함해야 한다.
      OR: [{ sys_role_code: null }, { sys_role_code: { not: "SUPER_ADMIN" } }],
      subscriptions:   { none: { sbscrptn_sttus_code: { in: [...LIVE_SUBSCRIPTION_STATUSES] } } },
    },
    select: { mber_id: true, email_addr: true, plan_code: true },
  });
  return rows.map((r) => ({ mberId: r.mber_id, email: r.email_addr, plan: r.plan_code }));
}

export type ManualPlanExpiryResult = {
  previousPlan: string;
  lockedCount:  number;
  autoUnlockedProjectName: string | null;
};

/**
 * 회원 1명의 만료 처리 — FREE 확정 + 소유 프로젝트 잠금 + 강등 메일.
 *
 * 멱등성: 처리하면 plan_code='FREE', plan_expire_dt=null 이 되어 다음 실행 대상에서 빠진다.
 * 메일은 커밋 뒤 await 로 보낸다(서버리스에서 void 는 유실 — 정책 §1-10). 메일 실패가
 * 강등을 되돌리지는 않는다.
 */
export async function processExpiredManualPlan(t: ManualPlanTarget, now: Date): Promise<ManualPlanExpiryResult> {
  const applied = await prisma.$transaction(async (tx) => {
    await tx.tbCmMember.update({
      where: { mber_id: t.mberId },
      data:  { plan_code: "FREE", plan_expire_dt: null, mdfcn_dt: now },
    });
    return syncLockForManualPlan(t.mberId, now, tx);
  });

  const autoUnlockedProjectName = applied.autoUnlockedProjectId
    ? (await prisma.tbPjProject.findUnique({
        where:  { prjct_id: applied.autoUnlockedProjectId },
        select: { prjct_nm: true },
      }))?.prjct_nm ?? null
    : null;

  if (t.email) {
    await sendDowngradedEmail({
      to:          t.email,
      productName: PRODUCTS[SPECODE_PRODUCT].name,
      reason:      "PLAN_EXPIRED",
      lockedCount: await countLockedProjects(t.mberId),
      autoUnlockedProjectName,
    });
  }

  return { previousPlan: t.plan, lockedCount: applied.lockedCount, autoUnlockedProjectName };
}

// ─── ⑥ PENDING 결제 시도 확정 ─────────────────────────────────────────────────

export type PendingTarget = { mberId: string; orderId: string; amount: number; createdAt: Date };

/** 10분 넘게 PENDING 인 시도가 있는 회원 (회원당 1건이라 회원 = 항목) */
export async function loadPendingTargets(now: Date): Promise<PendingTarget[]> {
  return loadStalePendingMembers(now);
}

export type PendingOutcome = { outcome: "PAID" | "PAID_UNAPPLIED" | "FAILED" | "UNKNOWN"; reason: string };

/**
 * 회원 1명의 PENDING 시도를 PG 조회로 확정한다.
 *   PAID    — 승인 확인 → 이력 확정 + 구독 반영 + 영수증 (돈은 이미 나갔다)
 *   FAILED  — 미청구 확인 → 이력만 실패로
 *   UNKNOWN — 조회로도 확정 못 함 → 그대로 두고 관리자 알림 (PG 콘솔 대조)
 */
export async function processPendingTarget(t: PendingTarget, now: Date): Promise<PendingOutcome> {
  const r = await resolvePendingPayments(t.mberId, now);
  if (r.blocked) return { outcome: "UNKNOWN", reason: r.reason };
  const mine = r.resolved[0];  // 회원당 진행 중 1건(UNIQUE)
  if (!mine) return { outcome: "UNKNOWN", reason: "확정 대상 없음(이미 처리됨)" };
  const reason =
    mine.outcome === "PAID"           ? "PG 승인 확인 → 반영" :
    mine.outcome === "PAID_UNAPPLIED" ? "PG 승인 확인됐으나 구독에 반영 못 함(종료/탈퇴/문맥 없음) — 환불 또는 수동 반영 판단 필요" :
                                        "PG 미청구 확인 → 실패 처리";
  return { outcome: mine.outcome, reason };
}
