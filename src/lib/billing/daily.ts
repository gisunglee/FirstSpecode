/**
 * billing/daily — 일일 청구 배치 본체 (라우트 /api/admin/batch/run/billing-daily 가 호출)
 *
 * 하루 1회, 살아 있는 구독(ACTIVE / PAST_DUE / CANCEL_SCHEDULED) 하나마다 순서대로:
 *   ① CANCEL_SCHEDULED 이고 주기가 끝났으면      → CANCELED · FREE · 잠금 · 메일
 *   ② ACTIVE 이고 next_bill_dt 가 지났으면       → 정기 결제 (축소 예약 적용). 실패 → PAST_DUE
 *   ③ PAST_DUE 이고 마지막 실패 + 3일이 지났으면 → 재시도. 소진 → EXPIRED · FREE · 잠금 · 메일
 *   ④ ACTIVE 이고 결제 7일 전이 지났고 아직 안 보냈으면 → 사전 안내 메일 (prentc_dt 기록)
 *
 * 멱등성: 같은 날 두 번 돌아도 ①~③은 상태 전이로, ④는 prentc_dt 로 중복 실행되지 않는다.
 * `now` 를 인자로 받는 이유: 스모크 테스트(scripts/billing-flow-db-smoke.ts)가 날짜를 앞으로
 * 돌려 한 달 뒤·재시도 3회·강등까지 실제 코드로 검증하기 위해. 라우트는 항상 현재 시각을 넘긴다.
 */

import { prisma } from "@/lib/prisma";
import {
  isLiveSubscriptionStatus,
  LIVE_SUBSCRIPTION_STATUSES,
  PRENOTICE_DAYS,
  PRODUCTS,
  RETRY_POLICY,
  SUBSCRIPTION_STATUS as S,
} from "./constants";
import { sendUpcomingChargeEmail } from "./emails";
import { addDays, monthlyAmount } from "./pricing";
import { attemptRecurringCharge, terminateSubscription } from "./subscription";

export const BILLING_DAILY_JOB_TYPE = "BILLING_DAILY";

export type DailyAction =
  | "CANCEL_FINALIZED"
  | "RENEWED"
  | "RENEW_FAILED"
  | "RETRY_SUCCEEDED"
  | "RETRY_FAILED"
  | "EXPIRED"
  | "PRENOTICE_SENT";

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
      await terminateSubscription(sub, S.CANCELED, now, email || null);
      actions.push("CANCEL_FINALIZED");
    }
    return actions;  // 해지 예정 구독은 청구·사전 안내 대상이 아니다
  }

  // ② 정기 결제
  if (sub.sbscrptn_sttus_code === S.ACTIVE && sub.next_bill_dt && sub.next_bill_dt <= now) {
    const r = await attemptRecurringCharge(sub, email, now, "RENEWAL");
    if (!r.ok && r.skipped) return actions;  // 다른 처리가 선점 — 오늘은 건너뛴다(다음 실행에 다시 판정)
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
      if (!r.ok && r.skipped) return actions;
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
