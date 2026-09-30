/**
 * GET /api/admin/billing/system-status — 결제 시스템 설정·상태 점검 (SUPER_ADMIN)
 *
 * "결제 시스템 안내" 화면(/admin/billing/guide)이 부른다. 환경변수는 존재 여부만 내려보내고 값은 절대 포함하지 않는다.
 * 계산은 src/lib/billing/system-status.ts.
 */

import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { getBillingSystemStatus } from "@/lib/billing/system-status";

export async function GET(request: NextRequest) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;
  try {
    return apiSuccess(await getBillingSystemStatus());
  } catch (err) {
    console.error("[GET /api/admin/billing/system-status] 오류:", err);
    return apiError("DB_ERROR", "결제 시스템 상태를 불러오지 못했습니다.", 500);
  }
}
