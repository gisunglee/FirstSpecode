/**
 * GET /api/member/me/owned-projects — 소유 프로젝트 목록 조회 (FID-00047)
 *
 * 역할:
 *   - 현재 로그인 회원이 소유(owner_mber_id)한 프로젝트 목록 반환 (탈퇴 화면 STEP 1 용)
 *   - 탈퇴 API(DELETE /api/member/me)가 정리하는 프로젝트와 정확히 같은 기준이어야
 *     화면에 보이는 것과 실제로 삭제되는 것이 어긋나지 않는다
 *
 * Header: Authorization: Bearer <AT>
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireAuth } from "@/lib/requireAuth";
import { ACTIVE_PROJECT_WHERE } from "@/lib/projectGuard";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    // 탈퇴 STEP 1: 위임/삭제 대상 소유 프로젝트만 노출.
    // 이미 삭제 처리된 프로젝트는 위임 대상이 아니므로 제외.
    const owned = await prisma.tbPjProject.findMany({
      where:   { owner_mber_id: auth.mberId, ...ACTIVE_PROJECT_WHERE },
      select:  { prjct_id: true, prjct_nm: true },
      orderBy: { creat_dt: "asc" },
    });

    const projects = owned.map((p) => ({
      projectId:   p.prjct_id,
      projectName: p.prjct_nm,
    }));

    return apiSuccess({ projects, totalCount: projects.length });

  } catch (err) {
    console.error("[GET /api/member/me/owned-projects] 오류:", err);
    return apiError("DB_ERROR", "소유 프로젝트 조회 중 오류가 발생했습니다.", 500);
  }
}
