/**
 * POST /api/admin/billing/subscriptions/[id]/terminate — 구독 강제 종료 (SUPER_ADMIN)
 *
 * 운영 사유(부정 사용·요청 처리 등)로 살아 있는 구독을 즉시 CANCELED. 해지 확정과 같은 경로라
 * FREE 강등·소유 프로젝트 잠금·강등 메일이 그대로 나간다. 되돌리기 = 회원이 다시 구독.
 * Body: { reason: string } → 감사 BILLING_FORCE_TERMINATE
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { logAdminAction } from "@/lib/audit";
import { adminTerminate } from "@/lib/billing/admin";
import { toBillingErrorResponse } from "@/lib/billing/errors";

type RouteParams = { params: Promise<{ id: string }> };
const bodySchema = z.object({ reason: z.string().trim().min(1, "사유를 입력해 주세요.").max(500) });

export async function POST(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;
  const { id } = await params;
  const parsed = await parseJsonBody(request, bodySchema);
  if (parsed instanceof Response) return parsed;

  try {
    const updated = await adminTerminate(id);
    await logAdminAction({
      adminMberId: gate.mberId, actionType: "BILLING_FORCE_TERMINATE", targetType: "SUBSCRIPTION", targetId: id,
      memo: `[강제 종료] → ${updated.status} · ${parsed.data.reason}`,
      ipAddr: gate.ipAddr, userAgent: gate.userAgent,
    });
    return apiSuccess(updated);
  } catch (err) {
    const known = toBillingErrorResponse(err);
    if (known) return known;
    console.error(`[POST /api/admin/billing/subscriptions/${id}/terminate] 오류:`, err);
    return apiError("BILLING_ERROR", "강제 종료 처리 중 오류가 발생했습니다.", 500);
  }
}
