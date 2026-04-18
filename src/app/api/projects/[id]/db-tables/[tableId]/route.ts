/**
 * GET    /api/projects/[id]/db-tables/[tableId] — DB 테이블 상세 (테이블 정보 + 컬럼 목록)
 * PUT    /api/projects/[id]/db-tables/[tableId] — DB 테이블 수정 + 컬럼 전체 교체
 * DELETE /api/projects/[id]/db-tables/[tableId] — DB 테이블 삭제 (컬럼 cascade)
 *
 * PUT body:
 *   { tblPhysclNm, tblLgclNm, tblDc,
 *     columns: [{ colId?, colPhysclNm, colLgclNm, dataTyNm, colDc, sortOrdr }] }
 *   - colId 있으면 update, 없으면 insert
 *   - 전달되지 않은 기존 컬럼은 삭제
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; tableId: string }> };

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, tableId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const table = await prisma.tbDsDbTable.findUnique({
      where: { tbl_id: tableId },
      include: {
        columns: { orderBy: { sort_ordr: "asc" } },
      },
    });

    if (!table || table.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "테이블을 찾을 수 없습니다.", 404);
    }

    return apiSuccess({
      tblId:       table.tbl_id,
      tblPhysclNm: table.tbl_physcl_nm,
      tblLgclNm:   table.tbl_lgcl_nm  ?? "",
      tblDc:       table.tbl_dc       ?? "",
      creatDt:     table.creat_dt.toISOString(),
      columns: table.columns.map((c) => ({
        colId:       c.col_id,
        colPhysclNm: c.col_physcl_nm,
        colLgclNm:   c.col_lgcl_nm  ?? "",
        dataTyNm:    c.data_ty_nm   ?? "",
        colDc:       c.col_dc       ?? "",
        sortOrdr:    c.sort_ordr,
      })),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/db-tables/${tableId}] DB 오류:`, err);
    return apiError("DB_ERROR", "DB 테이블 조회에 실패했습니다.", 500);
  }
}

// ── PUT ───────────────────────────────────────────────────────────────────────

type ColumnInput = {
  colId?:      string;
  colPhysclNm: string;
  colLgclNm?:  string;
  dataTyNm?:   string;
  colDc?:      string;
  sortOrdr?:   number;
};

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, tableId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { tblPhysclNm, tblLgclNm, tblDc, columns } = body as {
    tblPhysclNm?: string;
    tblLgclNm?:   string;
    tblDc?:       string;
    columns?:     ColumnInput[];
  };

  if (!tblPhysclNm?.trim()) {
    return apiError("VALIDATION_ERROR", "물리 테이블명은 필수입니다.", 400);
  }

  try {
    const existing = await prisma.tbDsDbTable.findUnique({ where: { tbl_id: tableId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "테이블을 찾을 수 없습니다.", 404);
    }

    const colList: ColumnInput[] = columns ?? [];
    const incomingIds = colList.map((c) => c.colId).filter(Boolean) as string[];

    await prisma.$transaction(async (tx) => {
      // 테이블 정보 업데이트
      await tx.tbDsDbTable.update({
        where: { tbl_id: tableId },
        data: {
          tbl_physcl_nm: tblPhysclNm.trim(),
          tbl_lgcl_nm:   tblLgclNm !== undefined ? (tblLgclNm?.trim() || null) : existing.tbl_lgcl_nm,
          tbl_dc:        tblDc !== undefined ? (tblDc?.trim() || null) : existing.tbl_dc,
        },
      });

      // 전달되지 않은 기존 컬럼 삭제
      await tx.tbDsDbTableColumn.deleteMany({
        where: {
          tbl_id: tableId,
          ...(incomingIds.length > 0 ? { col_id: { notIn: incomingIds } } : {}),
        },
      });

      // 컬럼 upsert (순서 유지)
      for (let i = 0; i < colList.length; i++) {
        const c = colList[i]!;
        if (c.colId) {
          await tx.tbDsDbTableColumn.update({
            where: { col_id: c.colId },
            data: {
              col_physcl_nm: c.colPhysclNm.trim(),
              col_lgcl_nm:   c.colLgclNm?.trim() || null,
              data_ty_nm:    c.dataTyNm?.trim()   || null,
              col_dc:        c.colDc?.trim()       || null,
              sort_ordr:     i + 1,
            },
          });
        } else {
          await tx.tbDsDbTableColumn.create({
            data: {
              tbl_id:        tableId,
              col_physcl_nm: c.colPhysclNm.trim(),
              col_lgcl_nm:   c.colLgclNm?.trim() || null,
              data_ty_nm:    c.dataTyNm?.trim()   || null,
              col_dc:        c.colDc?.trim()       || null,
              sort_ordr:     i + 1,
            },
          });
        }
      }
    });

    return apiSuccess({ tblId: tableId });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/db-tables/${tableId}] DB 오류:`, err);
    return apiError("DB_ERROR", "DB 테이블 수정에 실패했습니다.", 500);
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, tableId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const existing = await prisma.tbDsDbTable.findUnique({ where: { tbl_id: tableId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "테이블을 찾을 수 없습니다.", 404);
    }

    // 컬럼 먼저 삭제 후 테이블 삭제 (cascade 미설정 대비)
    await prisma.$transaction([
      prisma.tbDsDbTableColumn.deleteMany({ where: { tbl_id: tableId } }),
      prisma.tbDsDbTable.delete({ where: { tbl_id: tableId } }),
    ]);

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/db-tables/${tableId}] DB 오류:`, err);
    return apiError("DB_ERROR", "DB 테이블 삭제에 실패했습니다.", 500);
  }
}
