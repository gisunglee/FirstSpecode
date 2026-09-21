/**
 * POST /api/admin/projects/[id]/unlock — 결제 잠금 해제 대행 (SUPER_ADMIN)
 *
 * 소유자 연락이 안 될 때 운영자가 대신 "활성화". 소유자 버튼과 같은 상한 판정을 탄다.
 * 상한 초과면 풀지 않는다(409) — 운영 판단으로 풀어야 하면 관리자 수동 플랜 부여 뒤 다시 대행.
 * 해제와 감사(PROJECT_UNLOCK_BY_ADMIN)는 같은 트랜잭션.
 * Body: { reason: string }
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { adminUnlockProject } from "@/lib/billing/admin-actions";
import { BILLING_ERROR_CODES } from "@/lib/billing/constants";
import { toBillingErrorResponse } from "@/lib/billing/errors";

type RouteParams = { params: Promise<{ id: string }> };
const bodySchema = z.object({ reason: z.string().trim().min(1, "사유를 입력해 주세요.").max(500) });

export async function POST(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;
  const { id: projectId } = await params;
  const parsed = await parseJsonBody(request, bodySchema);
  if (parsed instanceof Response) return parsed;

  try {
    const result = await adminUnlockProject(projectId, gate, parsed.data.reason);
    if (!result.unlocked) {
      const v = result.verdict;
      const message = v.reason === "FREE_MEMBERS"
        ? `FREE 상한 초과 — 멤버 ${v.memberCount}명 > ${v.limit}명. 멤버를 줄이거나, 운영 판단이면 회원 상세에서 플랜을 부여한 뒤 다시 대행하세요.`
        : `좌석 상한 초과 — 사용 좌석 ${v.usedSeats} > ${v.limit}. 편집 멤버를 뷰어로 바꾸거나 좌석을 추가한 뒤 다시 대행하세요.`;
      return apiError(BILLING_ERROR_CODES.UNLOCK_OVER_LIMIT, message, 409, { ...v });
    }
    return apiSuccess(result);
  } catch (err) {
    const known = toBillingErrorResponse(err);
    if (known) return known;
    console.error(`[POST /api/admin/projects/${projectId}/unlock] 오류:`, err);
    return apiError("BILLING_ERROR", "잠금 해제 처리 중 오류가 발생했습니다.", 500);
  }
}
