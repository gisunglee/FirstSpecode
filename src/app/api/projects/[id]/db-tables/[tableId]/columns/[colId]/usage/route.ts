/**
 * GET /api/projects/[id]/db-tables/[tableId]/columns/[colId]/usage
 *   — 단일 컬럼의 사용처 상세 (드릴다운 팝업용, Phase 2)
 *
 * 응답:
 *   {
 *     column: { colId, colPhysclNm, colLgclNm },
 *     items:  [ { mappingId, ioSeCode, refType, refId, refName, scrnId, scrnNm, areaId, areaNm, usePurpsCn } ]
 *   }
 *
 * 권한: content.read
 *
 * route 는 권한/식별만 담당, 집계는 lib/dbTableUsage.ts 의 getColumnUsageDetail() 위임.
 */

import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { getColumnUsageDetail } from "@/lib/dbTableUsage";

type RouteParams = { params: Promise<{ id: string; tableId: string; colId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, tableId, colId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    const detail = await getColumnUsageDetail(projectId, tableId, colId);
    if (!detail) {
      return apiError("NOT_FOUND", "컬럼을 찾을 수 없거나 이 테이블/프로젝트에 속하지 않습니다.", 404);
    }
    return apiSuccess(detail);
  } catch (err) {
    console.error(`[GET .../columns/${colId}/usage] DB 오류:`, err);
    return apiError("DB_ERROR", "컬럼 사용 현황 조회에 실패했습니다.", 500);
  }
}
