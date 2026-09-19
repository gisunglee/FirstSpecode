/**
 * POST   /api/billing/cancel — 구독 해지 (기간 말 적용, 정책 §1-7)
 * DELETE /api/billing/cancel — 해지 취소 (기간이 끝나기 전이면 ACTIVE 복귀)
 *
 * 해지는 설정 화면에서 확인 1회로 바로 된다(다크패턴 규제 — 해지가 결제만큼 쉬워야 함).
 * PAST_DUE(결제 실패로 새 기간 미결제) 상태의 해지는 남은 유료 기간이 없어 즉시 종료된다.
 */

import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireBillingActor } from "@/lib/billing/actor";
import { toBillingErrorResponse } from "@/lib/billing/errors";
import { cancelSubscription, uncancelSubscription } from "@/lib/billing/subscription";

export async function POST(request: NextRequest) {
  const actor = await requireBillingActor(request);
  if (actor instanceof Response) return actor;

  try {
    return apiSuccess(await cancelSubscription(actor));
  } catch (err) {
    const known = toBillingErrorResponse(err);
    if (known) return known;
    console.error("[POST /api/billing/cancel] 오류:", err);
    return apiError("BILLING_ERROR", "해지 처리 중 오류가 발생했습니다.", 500);
  }
}

export async function DELETE(request: NextRequest) {
  const actor = await requireBillingActor(request);
  if (actor instanceof Response) return actor;

  try {
    return apiSuccess(await uncancelSubscription(actor));
  } catch (err) {
    const known = toBillingErrorResponse(err);
    if (known) return known;
    console.error("[DELETE /api/billing/cancel] 오류:", err);
    return apiError("BILLING_ERROR", "해지 취소 처리 중 오류가 발생했습니다.", 500);
  }
}
