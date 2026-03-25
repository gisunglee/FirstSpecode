/**
 * GET /api/projects/[id]/db-schema — DB 테이블·컬럼 목록 조회 (컬럼 매핑 팝업용)
 *
 * Query: tableId? — 특정 테이블의 컬럼 목록 조회
 *        tableId 없으면 테이블 목록만 반환
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
  const url     = new URL(request.url);
  const tableId = url.searchParams.get("tableId") ?? undefined;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    if (tableId) {
      // 특정 테이블의 컬럼 목록
      const columns = await prisma.tbDsTableColumn.findMany({
        where:   { tbl_id: tableId },
        orderBy: { sort_ordr: "asc" },
      });
      return apiSuccess({
        columns: columns.map((c) => ({
          colId:       c.col_id,
          colName:     c.col_physcl_nm,
          colLogicalNm: c.col_lgcl_nm ?? "",
          dataType:    c.data_ty_nm ?? "",
          description: c.col_dc ?? "",
        })),
      });
    }

    // 테이블 목록
    const tables = await prisma.tbDsDbTable.findMany({
      where:   { prjct_id: projectId },
      orderBy: { tbl_physcl_nm: "asc" },
    });
    return apiSuccess({
      tables: tables.map((t) => ({
        tableId:      t.tbl_id,
        tableName:    t.tbl_physcl_nm,
        tableLogicalNm: t.tbl_lgcl_nm ?? "",
        description:  t.tbl_dc ?? "",
      })),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/db-schema] DB 오류:`, err);
    return apiError("DB_ERROR", "DB 스키마 조회에 실패했습니다.", 500);
  }
}
