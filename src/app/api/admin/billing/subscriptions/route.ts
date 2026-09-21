/**
 * GET /api/admin/billing/subscriptions — 구독 목록 (SUPER_ADMIN)
 *
 * 파라미터: ?status=<ACTIVE|PAST_DUE|CANCEL_SCHEDULED|CANCELED|EXPIRED|LIVE> &search=<이메일·이름> &page &pageSize(≤200)
 * 정렬: 재시도 중(PAST_DUE)이 먼저, 그다음 결제일 임박 순.
 */

import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { listSubscriptionsForAdmin } from "@/lib/billing/admin";

const PAGE_SIZE_MAX = 200;

export async function GET(request: NextRequest) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const sp = request.nextUrl.searchParams;
  const page     = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(sp.get("pageSize") ?? "50", 10) || 50));

  try {
    return apiSuccess(await listSubscriptionsForAdmin({
      status: sp.get("status") ?? undefined,
      search: sp.get("search") ?? undefined,
      page, pageSize,
    }));
  } catch (err) {
    console.error("[GET /api/admin/billing/subscriptions] 오류:", err);
    return apiError("DB_ERROR", "구독 목록을 불러오지 못했습니다.", 500);
  }
}
