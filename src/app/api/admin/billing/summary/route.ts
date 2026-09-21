/**
 * GET /api/admin/billing/summary — 관리자 결제 대시보드 요약 (SUPER_ADMIN)
 *
 * 살아 있는 구독 수·상태별 수·좌석 합·월 예정 청구액·7일 내 결제 예정·잠긴 프로젝트·최근 30일 실패·
 * 이번 달 순매출·마지막 배치 결과. 계산은 src/lib/billing/admin.ts.
 */

import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { getBillingSummary } from "@/lib/billing/admin-queries";

export async function GET(request: NextRequest) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;
  try {
    return apiSuccess(await getBillingSummary());
  } catch (err) {
    console.error("[GET /api/admin/billing/summary] 오류:", err);
    return apiError("DB_ERROR", "결제 요약을 불러오지 못했습니다.", 500);
  }
}
