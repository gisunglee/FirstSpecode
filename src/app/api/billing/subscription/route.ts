/**
 * GET /api/billing/subscription — 내 구독 현황 (설정 > 구독·결제 화면 데이터 소스)
 *
 * 응답: { plan, subscription|null, usedSeats, lockedProjectCount, product, provider }
 *   - subscription 에는 빌링키·PG 내부 식별자가 없다 (toSubscriptionDto)
 *   - 로그인 세션 전용 (MCP 키 거부) — requireBillingActor
 */

import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireBillingActor } from "@/lib/billing/actor";
import { getBillingOverview } from "@/lib/billing/subscription";

export async function GET(request: NextRequest) {
  const actor = await requireBillingActor(request);
  if (actor instanceof Response) return actor;

  try {
    return apiSuccess(await getBillingOverview(actor.mberId));
  } catch (err) {
    console.error("[GET /api/billing/subscription] 오류:", err);
    return apiError("DB_ERROR", "구독 정보를 불러오지 못했습니다.", 500);
  }
}
