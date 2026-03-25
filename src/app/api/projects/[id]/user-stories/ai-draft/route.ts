/**
 * POST /api/projects/[id]/user-stories/ai-draft — AI 초안 생성 (FID-00115)
 *
 * TODO: 실제 AI 연동 전 stub 응답
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { requirementId } = body as { requirementId?: string };
  if (!requirementId) {
    return apiError("VALIDATION_ERROR", "requirementId가 필요합니다.", 400);
  }

  const req = await prisma.tbRqRequirement.findUnique({ where: { req_id: requirementId } });
  if (!req || req.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "요구사항을 찾을 수 없습니다.", 404);
  }

  // TODO: 실제 AI 연동으로 교체 (요구사항의 orgnl_cn, curncy_cn, spec_cn 기반)
  const reqName = req.req_nm || "요구사항";
  return apiSuccess({
    name:     `${reqName}에 대한 사용자스토리`,
    persona:  "서비스를 사용하는 일반 사용자로서",
    scenario: `나는 ${reqName} 기능을 이용하여 목표를 달성하고 싶다.`,
    acceptanceCriteria: [
      { given: "사용자가 로그인된 상태에서", when: "해당 기능에 접근하면", then: "정상적으로 화면이 표시된다." },
      { given: "필수 입력값이 모두 입력된 상태에서", when: "저장 버튼을 클릭하면", then: "데이터가 정상 저장된다." },
    ],
  });
}
