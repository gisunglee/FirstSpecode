/**
 * GET /api/projects/[id]/codes-all — 모든 공통코드 조회
 *
 * 역할:
 *   - 그룹 구분 없이 모든 공통코드를 그룹코드 → 정렬순서 순으로 조회
 *   - 각 코드에 그룹명(grpCodeNm)을 함께 반환하여 화면에서 그룹 컨텍스트 표시
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    // 프로젝트 스코프 — 해당 프로젝트의 모든 코드 + 소속 그룹 정보
    const codes = await prisma.tbCmCode.findMany({
      where: { prjct_id: projectId },
      include: { group: { select: { grp_code: true, grp_code_nm: true } } },
      orderBy: [{ group: { grp_code: "asc" } }, { sort_ordr: "asc" }, { creat_dt: "asc" }],
    });

    return apiSuccess({
      items: codes.map((c) => ({
        codeId: c.cm_code_id,
        cmCode: c.cm_code,
        grpCode: c.group.grp_code,
        grpCodeNm: c.group.grp_code_nm,
        codeNm: c.code_nm,
        codeDc: c.code_dc ?? "",
        useYn: c.use_yn,
        sortOrdr: c.sort_ordr,
      })),
    });
  } catch (err) {
    console.error("[GET /api/codes-all]", err);
    return apiError("DB_ERROR", "공통코드 전체 조회에 실패했습니다.", 500);
  }
}
