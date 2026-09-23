/**
 * GET /api/billing/seats/breakdown — 좌석 구성 (누가 좌석에 포함되나, 결제자 본인)
 *
 * 구독 화면의 "누가 포함되나요?" 펼치기와 좌석 축소 모달이 부른다.
 * 응답: { projectCount, editors[], viewers[], pendingEditorInvites } — 숫자 판정과 같은 기준(seats.ts).
 * 이메일은 소유자가 멤버 관리 화면에서 이미 보는 정보라 함께 내려준다.
 */

import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireBillingActor } from "@/lib/billing/actor";
import { getSeatBreakdown } from "@/lib/billing/seats";

export async function GET(request: NextRequest) {
  const actor = await requireBillingActor(request);
  if (actor instanceof Response) return actor;
  try {
    return apiSuccess(await getSeatBreakdown(actor.mberId));
  } catch (err) {
    console.error("[GET /api/billing/seats/breakdown] 오류:", err);
    return apiError("DB_ERROR", "좌석 구성을 불러오지 못했습니다.", 500);
  }
}
