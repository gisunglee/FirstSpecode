/**
 * POST /api/admin/batch/run/billing-daily — 일일 청구·재시도·만료 배치
 *
 * 호출:
 *   외부 cron (하루 1회):  curl -X POST -H 'X-Cron-Secret: <env>' .../billing-daily
 *   어드민 "수동 실행":    같은 엔드포인트 (JWT 세션, SUPER_ADMIN)
 *
 * 동작 (src/lib/billing/daily.ts):
 *   살아 있는 구독마다 ① 해지 확정 ② 정기 결제 ③ 재시도(3일 간격) ④ 결제 7일 전 안내.
 *   그리고 구독 없이 관리자가 수동 부여한 플랜 중 ⑤ 만료된 회원 → FREE 확정·프로젝트 잠금·메일.
 *   ⑥ 10분 넘게 PENDING 인 결제 시도 → PG 주문 조회로 확정(승인이면 반영·미청구면 실패·불명이면 관리자 알림).
 *   할 일이 없는 항목은 SKIPPED. PG 호출은 항목별로 격리돼 한 건 실패가 다른 건을 막지 않는다.
 *   같은 날 두 번 돌아도 상태 전이·prentc_dt·plan_code 확정으로 중복 청구·중복 메일이 나지 않는다.
 *
 * runJob 이 tb_cm_batch_job / _item 에 항목별 결과(수행 동작 목록)를 남긴다.
 */

import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { runJob } from "@/lib/batch/runJob";
import { requireBatchAuth } from "@/lib/batch/requireBatchAuth";
import {
  BILLING_DAILY_JOB_TYPE,
  loadDailyTargets,
  loadExpiredManualPlanTargets,
  loadPendingTargets,
  processExpiredManualPlan,
  processPendingTarget,
  processSubscriptionDaily,
  type DailyAction,
  type DailyTarget,
  type ManualPlanTarget,
  type PendingTarget,
} from "@/lib/billing/daily";
import { listAdminAlertRecipients } from "@/lib/billing/admin-queries";
import { sendAdminBillingAlertEmail } from "@/lib/billing/emails";

// 관리자에게 알릴 동작 — 성공 갱신·사전 안내는 평상시 일이라 제외
const ALERT_ACTIONS: ReadonlySet<DailyAction> = new Set<DailyAction>(["EXPIRED", "RENEW_FAILED", "RETRY_FAILED", "CANCEL_FINALIZED", "CHARGE_UNKNOWN"]);
const ALERT_LABEL: Record<string, string> = {
  EXPIRED: "재시도 소진 → FREE 강등·잠금", RENEW_FAILED: "정기 결제 실패(재시도 예정)",
  RETRY_FAILED: "재시도 실패", CANCEL_FINALIZED: "해지 확정 → FREE·잠금",
  PLAN_EXPIRED: "수동 부여 플랜 만료 → FREE·잠금",
  CHARGE_UNKNOWN: "⚠ 청구 결과 불명 — PENDING 유지, 다음 배치가 조회로 확정",
  PENDING_RECOVERED: "⚠ 결과 불명이던 청구가 승인으로 확인돼 반영됨(영수증 발송)",
  PENDING_UNRESOLVED: "🚨 PENDING 결제를 조회로도 확정 못 함 — PG 콘솔 대조 필요",
};

/**
 * 배치 항목 — 구독과 "수동 부여 플랜 만료" 두 종류를 한 잡에서 처리한다.
 * 잡을 나누지 않는 이유: 둘 다 "플랜이 끝나 잠그는" 같은 일이고, 운영자가 화면에서
 * 한 번에 보는 편이 낫다. 항목별 trgtTy 로 구분된다.
 */
type BatchItem =
  | { kind: "SUBSCRIPTION";     sub: DailyTarget }
  | { kind: "MANUAL_PLAN";      manual: ManualPlanTarget }
  | { kind: "PENDING_PAYMENT";  pending: PendingTarget };

export async function POST(request: NextRequest) {
  const auth = await requireBatchAuth(request);
  if (auth instanceof Response) return auth;

  // 관리자 알림용 — 항목별 동작을 모아 배치가 끝난 뒤 한 통으로 보낸다
  const notable: Array<{ label: string; actions: Array<DailyAction | "PLAN_EXPIRED" | "PENDING_RECOVERED" | "PENDING_UNRESOLVED"> }> = [];

  try {
    const result = await runJob<BatchItem>({
      jobTyCode:  BILLING_DAILY_JOB_TYPE,
      jobNm:      "결제 일일 배치 (청구·재시도·만료·사전안내)",
      trgrTyCode: auth.trigger,
      trgrMberId: auth.mberId,
      maxItems:   500,
      summary:    { invokedAt: new Date().toISOString() },

      async loadTargets() {
        const now = new Date();
        const [subs, manuals, pendings] = await Promise.all([loadDailyTargets(), loadExpiredManualPlanTargets(now), loadPendingTargets(now)]);
        return [
          // ⑥ 을 먼저 — 확정되지 않은 시도가 있는 구독은 ②③에서 어차피 건너뛰므로, 먼저 확정해야 같은 실행에서 청구까지 이어진다
          ...pendings.map((p) => ({
            item:   { kind: "PENDING_PAYMENT", pending: p } as BatchItem,
            trgtId: p.orderId,
            label:  `${p.orderId} (${p.amount.toLocaleString("ko-KR")}원, PENDING ${p.createdAt.toISOString()})`,
            trgtTy: "PAYMENT",
          })),
          ...subs.map((t) => ({
            item:   { kind: "SUBSCRIPTION", sub: t } as BatchItem,
            trgtId: t.sbscrptnId,
            label:  `${t.email ?? t.mberId} (${t.status})`,
            trgtTy: "SUBSCRIPTION",
          })),
          ...manuals.map((m) => ({
            item:   { kind: "MANUAL_PLAN", manual: m } as BatchItem,
            trgtId: m.mberId,
            label:  `${m.email ?? m.mberId} (수동 ${m.plan} 만료)`,
            trgtTy: "MEMBER",
          })),
        ];
      },

      async processItem(item) {
        if (item.kind === "PENDING_PAYMENT") {
          const r = await processPendingTarget(item.pending, new Date());
          if (r.outcome === "UNKNOWN") {
            notable.push({ label: item.pending.orderId, actions: ["PENDING_UNRESOLVED"] });
            // runJob 은 FAILED 를 throw 로만 받는다 — 항목 실패로 남겨 배치 결과가 PARTIAL 이 되게 한다
            throw new Error(`PENDING 확정 불가: ${r.reason}`);
          }
          if (r.outcome === "PAID") notable.push({ label: item.pending.orderId, actions: ["PENDING_RECOVERED"] });
          return { status: "SUCCESS", meta: { outcome: r.outcome, reason: r.reason } };
        }
        if (item.kind === "MANUAL_PLAN") {
          const m = item.manual;
          const r = await processExpiredManualPlan(m, new Date());
          // 수동 플랜 만료도 강등이므로 관리자 알림 대상
          notable.push({ label: m.email ?? m.mberId, actions: ["PLAN_EXPIRED"] });
          return { status: "SUCCESS", meta: { previousPlan: r.previousPlan, lockedCount: r.lockedCount, autoUnlocked: r.autoUnlockedProjectName } };
        }

        const t = item.sub;
        const actions = await processSubscriptionDaily(t.sbscrptnId, new Date());
        if (actions.length === 0) {
          return { status: "SKIPPED", reason: "오늘 할 일 없음", meta: { statusBefore: t.status } };
        }
        if (actions.some((a) => ALERT_ACTIONS.has(a))) notable.push({ label: t.email ?? t.mberId, actions });
        return { status: "SUCCESS", meta: { statusBefore: t.status, actions } };
      },
    });

    // 관리자 알림 — 배치 자체가 실패/부분 실패했거나, 강등·결제 실패·해지 확정이 있으면 하루 1통.
    // 발송 실패는 배치 결과를 바꾸지 않는다.
    if (result.ttusCode !== "SUCCESS" || notable.length > 0) {
      const lines: string[] = [
        `배치 결과 ${result.ttusCode} — 대상 ${result.trgtCnt} · 처리 ${result.successCnt} · 실패 ${result.failCnt} · 건너뜀 ${result.skipCnt}`,
        ...notable.map((n) => `${n.label}: ${n.actions.map((a) => ALERT_LABEL[a] ?? a).join(", ")}`),
      ];
      await sendAdminBillingAlertEmail({
        to: await listAdminAlertRecipients(),
        subject: result.ttusCode !== "SUCCESS" ? `결제 일일 배치 ${result.ttusCode}` : `결제 일일 배치 — 확인 필요 ${notable.length}건`,
        lines,
      });
    }

    return apiSuccess(result);
  } catch (err) {
    console.error("[POST /api/admin/batch/run/billing-daily] 오류:", err);
    return apiError("BATCH_ERROR", "배치 실행 중 오류가 발생했습니다.", 500);
  }
}
