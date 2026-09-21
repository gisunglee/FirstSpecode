/**
 * POST /api/admin/billing/subscriptions/[id]/defer — 다음 결제일 N일 연기 (SUPER_ADMIN)
 *
 * 장애 보상·민원 처리용. ACTIVE 구독의 주기 종료·다음 결제일을 뒤로 민다. 좌석·단가는 그대로.
 * 결제 진행 중이면 409. 상태 변경과 감사 기록은 같은 트랜잭션.
 * Body: { days: 1~90, reason: string }
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { adminDeferBilling, DEFER_DAYS_LIMITS } from "@/lib/billing/admin-actions";
import { toBillingErrorResponse } from "@/lib/billing/errors";

type RouteParams = { params: Promise<{ id: string }> };
const bodySchema = z.object({
  days:   z.number().int().min(DEFER_DAYS_LIMITS.min).max(DEFER_DAYS_LIMITS.max),
  reason: z.string().trim().min(1, "사유를 입력해 주세요.").max(500),
});

export async function POST(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;
  const { id } = await params;
  const parsed = await parseJsonBody(request, bodySchema);
  if (parsed instanceof Response) return parsed;

  try {
    return apiSuccess(await adminDeferBilling(id, parsed.data.days, gate, parsed.data.reason));
  } catch (err) {
    const known = toBillingErrorResponse(err);
    if (known) return known;
    console.error(`[POST /api/admin/billing/subscriptions/${id}/defer] 오류:`, err);
    return apiError("BILLING_ERROR", "결제일 연기 처리 중 오류가 발생했습니다.", 500);
  }
}
