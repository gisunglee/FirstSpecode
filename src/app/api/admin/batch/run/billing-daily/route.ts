/**
 * POST /api/admin/batch/run/billing-daily — 일일 청구·재시도·만료 배치
 *
 * 호출:
 *   외부 cron (하루 1회):  curl -X POST -H 'X-Cron-Secret: <env>' .../billing-daily
 *   어드민 "수동 실행":    같은 엔드포인트 (JWT 세션, SUPER_ADMIN)
 *
 * 동작 (src/lib/billing/daily.ts):
 *   살아 있는 구독마다 ① 해지 확정 ② 정기 결제 ③ 재시도(3일 간격) ④ 결제 7일 전 안내.
 *   할 일이 없는 구독은 SKIPPED. PG 호출은 항목별로 격리돼 한 건 실패가 다른 건을 막지 않는다.
 *   같은 날 두 번 돌아도 상태 전이·prentc_dt 로 중복 청구·중복 메일이 나지 않는다.
 *
 * runJob 이 tb_cm_batch_job / _item 에 항목별 결과(수행 동작 목록)를 남긴다.
 */

import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { runJob } from "@/lib/batch/runJob";
import { requireBatchAuth } from "@/lib/batch/requireBatchAuth";
import { BILLING_DAILY_JOB_TYPE, loadDailyTargets, processSubscriptionDaily, type DailyAction, type DailyTarget } from "@/lib/billing/daily";
import { listAdminAlertRecipients } from "@/lib/billing/admin";
import { sendAdminBillingAlertEmail } from "@/lib/billing/emails";

// 관리자에게 알릴 동작 — 성공 갱신·사전 안내는 평상시 일이라 제외
const ALERT_ACTIONS: ReadonlySet<DailyAction> = new Set<DailyAction>(["EXPIRED", "RENEW_FAILED", "RETRY_FAILED", "CANCEL_FINALIZED"]);
const ALERT_LABEL: Record<string, string> = {
  EXPIRED: "재시도 소진 → FREE 강등·잠금", RENEW_FAILED: "정기 결제 실패(재시도 예정)",
  RETRY_FAILED: "재시도 실패", CANCEL_FINALIZED: "해지 확정 → FREE·잠금",
};

export async function POST(request: NextRequest) {
  const auth = await requireBatchAuth(request);
  if (auth instanceof Response) return auth;

  // 관리자 알림용 — 항목별 동작을 모아 배치가 끝난 뒤 한 통으로 보낸다
  const notable: Array<{ label: string; actions: DailyAction[] }> = [];

  try {
    const result = await runJob<DailyTarget>({
      jobTyCode:  BILLING_DAILY_JOB_TYPE,
      jobNm:      "결제 일일 배치 (청구·재시도·만료·사전안내)",
      trgrTyCode: auth.trigger,
      trgrMberId: auth.mberId,
      maxItems:   500,
      summary:    { invokedAt: new Date().toISOString() },

      async loadTargets() {
        const targets = await loadDailyTargets();
        return targets.map((t) => ({
          item:   t,
          trgtId: t.sbscrptnId,
          label:  `${t.email ?? t.mberId} (${t.status})`,
          trgtTy: "SUBSCRIPTION",
        }));
      },

      async processItem(t) {
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
