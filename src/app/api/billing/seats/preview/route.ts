/**
 * GET /api/billing/seats/preview?add=N — 좌석 추가 일할 금액 미리보기 (좌석 추가 모달)
 *
 * 응답: { addSeats, amount, remainingDays, periodDays, unitPrice, newSeatCnt, newMonthlyAmount, periodEnd }
 * 금액 계산은 서버에서만 한다 — 화면이 따로 계산하면 반올림이 어긋나 "미리 본 금액과 다르게 결제됐다" 는 민원이 난다.
 */

import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireBillingActor } from "@/lib/billing/actor";
import { toBillingErrorResponse } from "@/lib/billing/errors";
import { previewSeatAddition } from "@/lib/billing/subscription";

export async function GET(request: NextRequest) {
  const actor = await requireBillingActor(request);
  if (actor instanceof Response) return actor;

  const add = Number(request.nextUrl.searchParams.get("add"));
  if (!Number.isInteger(add) || add < 1) {
    return apiError("VALIDATION_ERROR", "추가 좌석 수(add)는 1 이상의 정수여야 합니다.", 400);
  }

  try {
    return apiSuccess(await previewSeatAddition(actor.mberId, add));
  } catch (err) {
    const known = toBillingErrorResponse(err);
    if (known) return known;
    console.error("[GET /api/billing/seats/preview] 오류:", err);
    return apiError("BILLING_ERROR", "일할 금액을 계산하지 못했습니다.", 500);
  }
}
