/**
 * GET  /api/projects/[id]/db-tables — DB 테이블 목록 (컬럼 수 포함)
 * POST /api/projects/[id]/db-tables — DB 테이블 생성
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
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const tables = await prisma.tbDsDbTable.findMany({
      where: { prjct_id: projectId },
      include: { _count: { select: { columns: true } } },
      orderBy: { tbl_physcl_nm: "asc" },
    });

    return apiSuccess(
      tables.map((t) => ({
        tblId:       t.tbl_id,
        tblPhysclNm: t.tbl_physcl_nm,
        tblLgclNm:   t.tbl_lgcl_nm  ?? "",
        tblDc:       t.tbl_dc       ?? "",
        creatDt:     t.creat_dt.toISOString(),
        columnCount: t._count.columns,
      }))
    );
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/db-tables] DB 오류:`, err);
    return apiError("DB_ERROR", "DB 테이블 목록 조회에 실패했습니다.", 500);
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

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

  const { tblPhysclNm, tblLgclNm, tblDc } = body as {
    tblPhysclNm?: string;
    tblLgclNm?:   string;
    tblDc?:       string;
  };

  if (!tblPhysclNm?.trim()) {
    return apiError("VALIDATION_ERROR", "물리 테이블명은 필수입니다.", 400);
  }

  try {
    const created = await prisma.tbDsDbTable.create({
      data: {
        prjct_id:      projectId,
        tbl_physcl_nm: tblPhysclNm.trim(),
        tbl_lgcl_nm:   tblLgclNm?.trim() || null,
        tbl_dc:        tblDc?.trim()     || null,
      },
    });

    return apiSuccess({ tblId: created.tbl_id }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/db-tables] DB 오류:`, err);
    return apiError("DB_ERROR", "DB 테이블 생성에 실패했습니다.", 500);
  }
}
