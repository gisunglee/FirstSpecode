/**
 * GET /api/member/me/owned-projects — 소유 프로젝트 목록 조회 (FID-00047)
 *
 * 역할:
 *   - 현재 로그인 회원의 OWNER 프로젝트 목록 반환 (탈퇴 화면 STEP 1 용)
 *
 * Header: Authorization: Bearer <AT>
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireAuth } from "@/lib/requireAuth";

export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const memberships = await prisma.tbPjProjectMember.findMany({
      where: {
        mber_id:         auth.mberId,
        role_code:       "OWNER",
        mber_sttus_code: "ACTIVE",
      },
      include: {
        project: {
          select: { prjct_id: true, prjct_nm: true },
        },
      },
    });

    const projects = memberships.map((m) => ({
      projectId:   m.project.prjct_id,
      projectName: m.project.prjct_nm,
    }));

    return apiSuccess({ projects, totalCount: projects.length });

  } catch (err) {
    console.error("[GET /api/member/me/owned-projects] 오류:", err);
    return apiError("DB_ERROR", "소유 프로젝트 조회 중 오류가 발생했습니다.", 500);
  }
}
