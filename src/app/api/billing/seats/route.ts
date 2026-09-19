/**
 * PATCH /api/billing/seats — 좌석 수 변경 (목표 좌석 수 하나로 추가·축소·예약 취소)
 *
 * Body: { seatCnt: number }
 *   현재보다 크면 → 남은 일수 일할 즉시 결제 후 반영          (action: ADDED)
 *   현재보다 작으면 → 다음 결제일 적용 예약 (환불 없음)         (action: REDUCE_SCHEDULED)
 *   현재와 같으면 → 축소 예약이 있으면 취소                     (action: REDUCE_CANCELED | NO_CHANGE)
 * 사용 좌석보다 작게는 못 줄인다 (400 BILLING_SEAT_COUNT_INVALID).
 * 일할 금액 미리보기는 GET /api/billing/seats/preview?add=N.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { requireBillingActor } from "@/lib/billing/actor";
import { SEAT_INPUT_LIMITS } from "@/lib/billing/constants";
import { toBillingErrorResponse } from "@/lib/billing/errors";
import { changeSeats } from "@/lib/billing/subscription";

const bodySchema = z.object({
  seatCnt: z.number().int().min(SEAT_INPUT_LIMITS.min).max(SEAT_INPUT_LIMITS.max),
});

export async function PATCH(request: NextRequest) {
  const actor = await requireBillingActor(request);
  if (actor instanceof Response) return actor;

  const parsed = await parseJsonBody(request, bodySchema);
  if (parsed instanceof Response) return parsed;

  try {
    return apiSuccess(await changeSeats(actor, parsed.data.seatCnt));
  } catch (err) {
    const known = toBillingErrorResponse(err);
    if (known) return known;
    console.error("[PATCH /api/billing/seats] 오류:", err);
    return apiError("BILLING_ERROR", "좌석 변경 처리 중 오류가 발생했습니다.", 500);
  }
}
