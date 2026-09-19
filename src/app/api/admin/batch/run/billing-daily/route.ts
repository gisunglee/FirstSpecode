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
import { BILLING_DAILY_JOB_TYPE, loadDailyTargets, processSubscriptionDaily, type DailyTarget } from "@/lib/billing/daily";

export async function POST(request: NextRequest) {
  const auth = await requireBatchAuth(request);
  if (auth instanceof Response) return auth;

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
        return { status: "SUCCESS", meta: { statusBefore: t.status, actions } };
      },
    });

    return apiSuccess(result);
  } catch (err) {
    console.error("[POST /api/admin/batch/run/billing-daily] 오류:", err);
    return apiError("BATCH_ERROR", "배치 실행 중 오류가 발생했습니다.", 500);
  }
}
