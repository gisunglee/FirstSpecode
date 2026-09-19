/**
 * POST /api/billing/subscription/start — BASIC 시작 1단계: 카드 등록 시작
 *
 * Body: { seatCnt: number }
 * 응답: 게이트웨이 카드 등록 시작 결과
 *   { mode: "redirect", url }              — Mock: 앱 안 "PG 창"으로 이동
 *   { mode: "sdk", clientKey, customerKey } — Toss: 브라우저 SDK 가 창을 띄움 (심사 후)
 *
 * 실제 결제는 PG 가 돌려보낸 뒤 POST /api/billing/card/callback 에서 일어난다.
 * 여기서는 좌석 수만 검증한다(사용 좌석 이상, 범위 내).
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { requireBillingActor } from "@/lib/billing/actor";
import { SEAT_INPUT_LIMITS } from "@/lib/billing/constants";
import { toBillingErrorResponse } from "@/lib/billing/errors";
import { beginCardRegistration } from "@/lib/billing/subscription";

const bodySchema = z.object({
  seatCnt: z.number().int().min(SEAT_INPUT_LIMITS.min).max(SEAT_INPUT_LIMITS.max),
});

export async function POST(request: NextRequest) {
  const actor = await requireBillingActor(request);
  if (actor instanceof Response) return actor;

  const parsed = await parseJsonBody(request, bodySchema);
  if (parsed instanceof Response) return parsed;

  try {
    const start = await beginCardRegistration(actor, "start", parsed.data.seatCnt);
    return apiSuccess(start);
  } catch (err) {
    const known = toBillingErrorResponse(err);
    if (known) return known;
    console.error("[POST /api/billing/subscription/start] 오류:", err);
    return apiError("BILLING_ERROR", "구독 시작 처리 중 오류가 발생했습니다.", 500);
  }
}
