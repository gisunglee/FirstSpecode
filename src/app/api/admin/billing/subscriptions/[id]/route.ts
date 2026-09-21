/**
 * GET /api/admin/billing/subscriptions/[id] — 구독 상세 (SUPER_ADMIN)
 *
 * 구독 DTO + 회원 + 사용 좌석 + 환불 판정 3플래그 + 소유 프로젝트(잠금·멤버 수) + 결제 이력(최근 100건).
 * 관리자 운영 액션(재결제·연기·종료·환불 기록·잠금 해제)의 근거 화면.
 */

import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { getSubscriptionDetailForAdmin } from "@/lib/billing/admin";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;
  const { id } = await params;
  try {
    const detail = await getSubscriptionDetailForAdmin(id);
    if (!detail) return apiError("NOT_FOUND", "구독을 찾을 수 없습니다.", 404);
    return apiSuccess(detail);
  } catch (err) {
    console.error(`[GET /api/admin/billing/subscriptions/${id}] 오류:`, err);
    return apiError("DB_ERROR", "구독 상세를 불러오지 못했습니다.", 500);
  }
}
