/**
 * GET /api/projects/[id]/check-masters — 공통 점검 마스터 목록 조회
 *
 * 반환 범위:
 *   - 시스템 공통 (prjct_id IS NULL)
 *   - + 현재 프로젝트 전용 (prjct_id = :id)
 *   - use_yn = 'Y' 만
 *
 * 정렬: ctgry_code → sort_ordr → creat_dt
 *
 * 향후 POST/PUT/DELETE 는 별도 라우트로 — 시스템 시드는 admin 페이지에서,
 * 프로젝트 전용은 OWNER/ADMIN 페이지에서 관리 (Phase 후속).
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const url      = new URL(request.url);
  const ctgryQ   = url.searchParams.get("ctgry") ?? undefined;

  try {
    const rows = await prisma.tbQaCheckMaster.findMany({
      where: {
        use_yn: "Y",
        ...(ctgryQ && { ctgry_code: ctgryQ }),
        // 시스템 공통(prjct_id NULL) + 본 프로젝트 전용 둘 다
        OR: [
          { prjct_id: null },
          { prjct_id: projectId },
        ],
      },
      orderBy: [
        { ctgry_code: "asc" },
        { sort_ordr:  "asc" },
        { creat_dt:   "asc" },
      ],
    });

    const items = rows.map((r) => ({
      checkId:    r.check_id,
      scope:      r.prjct_id === null ? "SYSTEM" : "PROJECT",
      ctgryCode:  r.ctgry_code,
      scenarioCn: r.scenario_cn,
      expectedCn: r.expected_cn ?? "",
      sortOrdr:   r.sort_ordr,
    }));

    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/check-masters] DB 오류:`, err);
    return apiError("DB_ERROR", "공통 점검 마스터 조회에 실패했습니다.", 500);
  }
}
