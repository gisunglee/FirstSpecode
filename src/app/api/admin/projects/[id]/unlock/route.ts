/**
 * POST /api/admin/projects/[id]/unlock — 결제 잠금 해제 대행 (SUPER_ADMIN)
 *
 * 소유자 연락이 안 될 때 운영자가 대신 "활성화". 기본은 소유자 버튼과 같은 상한 판정을 타고,
 * 초과인데도 풀어야 하면 force=true + 사유 필수 (감사 PROJECT_FORCE_UNLOCK 에 남음).
 * Body: { reason: string, force?: boolean }
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { logAdminAction } from "@/lib/audit";
import { adminUnlockProject } from "@/lib/billing/admin";
import { BILLING_ERROR_CODES } from "@/lib/billing/constants";
import { toBillingErrorResponse } from "@/lib/billing/errors";

type RouteParams = { params: Promise<{ id: string }> };
const bodySchema = z.object({
  reason: z.string().trim().min(1, "사유를 입력해 주세요.").max(500),
  force:  z.boolean().optional().default(false),
});

export async function POST(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;
  const { id: projectId } = await params;
  const parsed = await parseJsonBody(request, bodySchema);
  if (parsed instanceof Response) return parsed;

  try {
    const result = await adminUnlockProject(projectId, parsed.data.force);
    if (!result.unlocked) {
      const v = result.verdict;
      const message = v.reason === "FREE_MEMBERS"
        ? `FREE 상한 초과 — 멤버 ${v.memberCount}명 > ${v.limit}명. 강제로 풀려면 force 를 켜고 사유를 남기세요.`
        : `좌석 상한 초과 — 사용 좌석 ${v.usedSeats} > ${v.limit}. 강제로 풀려면 force 를 켜고 사유를 남기세요.`;
      return apiError(BILLING_ERROR_CODES.UNLOCK_OVER_LIMIT, message, 409, { ...v });
    }
    await logAdminAction({
      adminMberId: gate.mberId, actionType: "PROJECT_FORCE_UNLOCK", targetType: "PROJECT", targetId: projectId,
      memo: `[잠금 해제 대행${result.forced ? " · 상한 초과 강제" : ""}] ${parsed.data.reason}`,
      ipAddr: gate.ipAddr, userAgent: gate.userAgent,
    });
    return apiSuccess(result);
  } catch (err) {
    const known = toBillingErrorResponse(err);
    if (known) return known;
    console.error(`[POST /api/admin/projects/${projectId}/unlock] 오류:`, err);
    return apiError("BILLING_ERROR", "잠금 해제 처리 중 오류가 발생했습니다.", 500);
  }
}
