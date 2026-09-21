/**
 * POST /api/admin/billing/subscriptions/[id]/terminate — 구독 강제 종료 (SUPER_ADMIN)
 *
 * 운영 사유로 살아 있는 구독을 즉시 CANCELED(사유 ADMIN_TERMINATE). 해지 확정과 같은 경로라
 * FREE 강등·소유 프로젝트 잠금·강등 메일이 그대로 나간다. 결제 진행 중이면 409.
 * 상태 변경과 감사 기록은 같은 트랜잭션. 되돌리기 = 회원이 다시 구독(카드 재등록).
 * Body: { reason: string }
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { adminTerminate } from "@/lib/billing/admin-actions";
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
    return apiSuccess(await adminTerminate(id, gate, parsed.data.reason));
  } catch (err) {
    const known = toBillingErrorResponse(err);
    if (known) return known;
    console.error(`[POST /api/admin/billing/subscriptions/${id}/terminate] 오류:`, err);
    return apiError("BILLING_ERROR", "강제 종료 처리 중 오류가 발생했습니다.", 500);
  }
}
