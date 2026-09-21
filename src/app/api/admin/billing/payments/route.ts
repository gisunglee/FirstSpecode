/**
 * GET /api/admin/billing/payments — 결제 이력 전체 (SUPER_ADMIN)
 *
 * 파라미터: ?from=YYYY-MM-DD &to=YYYY-MM-DD(포함) &status=<PAID|FAILED|REFUNDED> &type=<INITIAL|RECURRING|SEAT_ADD|REFUND>
 *           &search=<회원 이메일·이름> &page &pageSize(≤200)
 * 응답에 필터 범위의 금액 합계(sumAmount, PAID+REFUNDED 순액)를 함께 준다 — PG 정산 대조용.
 * 날짜는 KST 하루 경계로 해석한다.
 */

import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { listPaymentsForAdmin } from "@/lib/billing/admin-queries";
import { parsePaymentFilters } from "./filters";

const PAGE_SIZE_MAX = 200;

export async function GET(request: NextRequest) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const sp = request.nextUrl.searchParams;
  const filters = parsePaymentFilters(sp);
  if (filters instanceof Response) return filters;
  const page     = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(sp.get("pageSize") ?? "50", 10) || 50));

  try {
    return apiSuccess(await listPaymentsForAdmin({ ...filters, page, pageSize }));
  } catch (err) {
    console.error("[GET /api/admin/billing/payments] 오류:", err);
    return apiError("DB_ERROR", "결제 이력을 불러오지 못했습니다.", 500);
  }
}
