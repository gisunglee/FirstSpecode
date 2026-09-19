/**
 * POST /api/billing/card/change — 결제 수단 변경 1단계: 새 카드 등록 시작
 *
 * 살아 있는 구독이 있어야 한다. PG 가 돌려보낸 뒤 POST /api/billing/card/callback (purpose=change)
 * 에서 빌링키가 교체되고, 재시도 중(PAST_DUE)이었다면 바로 재결제한다.
 */

import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireBillingActor } from "@/lib/billing/actor";
import { toBillingErrorResponse } from "@/lib/billing/errors";
import { beginCardRegistration } from "@/lib/billing/subscription";

export async function POST(request: NextRequest) {
  const actor = await requireBillingActor(request);
  if (actor instanceof Response) return actor;

  try {
    return apiSuccess(await beginCardRegistration(actor, "change"));
  } catch (err) {
    const known = toBillingErrorResponse(err);
    if (known) return known;
    console.error("[POST /api/billing/card/change] 오류:", err);
    return apiError("BILLING_ERROR", "결제 수단 변경 처리 중 오류가 발생했습니다.", 500);
  }
}
