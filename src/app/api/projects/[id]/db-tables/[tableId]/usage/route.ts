/**
 * GET /api/projects/[id]/db-tables/[tableId]/usage
 *   — DB 테이블 "사용 현황" 조회 (매핑 인사이트 Phase 1)
 *
 * 응답:
 *   {
 *     summary:     { functionCount, areaCount, screenCount, usedColCount, totalColCount },
 *     usedBy:      [ { refType, refId, refName, scrnId, scrnNm, areaId, areaNm, ioProfile, colCount } ],
 *     columnUsage: { [colId]: { in, out, inout, total } }
 *   }
 *
 * 권한: content.read (VIEWER 포함 모든 멤버)
 *
 * 구현 위임:
 *   - 집계 로직은 `lib/dbTableUsage.ts` 의 getTableUsageDetail() 에 전부 위임.
 *     route 파일은 권한/존재 확인만 담당한다 (책임 분리).
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { getTableUsageDetail } from "@/lib/dbTableUsage";

type RouteParams = { params: Promise<{ id: string; tableId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, tableId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    // 테이블 존재 + 프로젝트 소속 검증 (다른 프로젝트의 tableId 조회 차단)
    const table = await prisma.tbDsDbTable.findUnique({
      where:  { tbl_id: tableId },
      select: { prjct_id: true },
    });
    if (!table || table.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "테이블을 찾을 수 없습니다.", 404);
    }

    const usage = await getTableUsageDetail(projectId, tableId);
    return apiSuccess(usage);
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/db-tables/${tableId}/usage] DB 오류:`, err);
    return apiError("DB_ERROR", "사용 현황 조회에 실패했습니다.", 500);
  }
}
