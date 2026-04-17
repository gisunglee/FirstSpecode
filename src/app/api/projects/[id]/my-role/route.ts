/**
 * GET /api/projects/[id]/my-role — 내 역할 조회 (UW-00011)
 *
 * 역할:
 *   - 현재 로그인 사용자의 프로젝트 내 역할 반환
 *   - 클라이언트의 UI 권한 제어(메뉴 숨김·버튼 비활성화) 판별용
 *   - 미가입 또는 비활성 멤버 → 403
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });

  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "프로젝트 멤버가 아닙니다.", 403);
  }

  return apiSuccess({ myRole: membership.role_code });
}
