/**
 * GET /api/projects/my — 내 프로젝트 목록 조회 (FID-00202)
 *
 * GNB 프로젝트 셀렉터 드롭다운 데이터 소스
 * requireAuth로 JWT에서 mber_id 추출
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { ACTIVE_PROJECT_RELATION_WHERE } from "@/lib/projectGuard";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    // MCP scope 키면 해당 프로젝트만 노출 — GNB 드롭다운에도 scope 적용해서
    // "자기 키로 접근 불가한 프로젝트"가 선택 가능하게 보이는 UX 사고 방지.
    const memberships = await prisma.tbPjProjectMember.findMany({
      where: {
        mber_id:         auth.mberId,
        mber_sttus_code: "ACTIVE",
        ...(auth.allowedPrjctId ? { prjct_id: auth.allowedPrjctId } : {}),
        // 삭제 예정 프로젝트는 GNB/LNB 드롭다운에 노출되지 않아야 한다.
        project: ACTIVE_PROJECT_RELATION_WHERE,
      },
      include: {
        project: {
          select: {
            prjct_id: true,
            prjct_nm: true,
          },
        },
      },
      orderBy: {
        // 마지막 접속 시간 기준 내림차순 — 최근 작업 프로젝트 우선
        last_acces_dt: "desc",
      },
    });

    const items = memberships.map((m) => ({
      prjct_id:  m.project.prjct_id,
      prjct_nm:  m.project.prjct_nm,
      role_code: m.role_code,
    }));

    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error("[GET /api/projects/my] DB 오류:", err);
    return apiError("DB_ERROR", "프로젝트 목록 조회에 실패했습니다.", 500);
  }
}
