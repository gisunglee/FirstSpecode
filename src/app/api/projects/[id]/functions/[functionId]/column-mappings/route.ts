/**
 * GET  /api/projects/[id]/functions/[functionId]/column-mappings — 컬럼 매핑 목록 (FID-00178)
 * POST /api/projects/[id]/functions/[functionId]/column-mappings — 전체 매핑 교체 저장 (FID-00181)
 *
 * POST Body: { mappings: [{colId, purpose}][] }
 *   - 서버는 기존 매핑 전체 DELETE 후 새 목록 INSERT (upsert 대신 교체 방식)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; functionId: string }> };

// ─── GET: 컬럼 매핑 목록 조회 ────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, functionId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const mappings = await prisma.tbDsFunctionColumnMapping.findMany({
      where:   { func_id: functionId },
      orderBy: { sort_ordr: "asc" },
      include: {
        column: {
          include: {
            table: { select: { tbl_id: true, tbl_physcl_nm: true, tbl_lgcl_nm: true } },
          },
        },
      },
    });

    return apiSuccess({
      items: mappings.map((m) => ({
        mappingId:      m.mapping_id,
        colId:          m.col_id,
        colName:        m.column.col_physcl_nm,
        colLogicalNm:   m.column.col_lgcl_nm ?? "",
        tableId:        m.column.table.tbl_id,
        tableName:      m.column.table.tbl_physcl_nm,
        tableLogicalNm: m.column.table.tbl_lgcl_nm ?? "",
        purpose:        m.use_purps_cn ?? "",
        sortOrder:      m.sort_ordr,
      })),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/functions/${functionId}/column-mappings] DB 오류:`, err);
    return apiError("DB_ERROR", "컬럼 매핑 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 컬럼 매핑 전체 교체 저장 ──────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, functionId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { mappings } = body as { mappings?: { colId: string; purpose?: string }[] };
  if (!Array.isArray(mappings)) {
    return apiError("VALIDATION_ERROR", "mappings 배열이 필요합니다.", 400);
  }

  try {
    const existing = await prisma.tbDsFunction.findUnique({ where: { func_id: functionId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "기능을 찾을 수 없습니다.", 404);
    }

    // 기존 매핑 전체 삭제 후 새 목록 INSERT + 이력 기록 (트랜잭션)
    await prisma.$transaction([
      prisma.tbDsFunctionColumnMapping.deleteMany({ where: { func_id: functionId } }),
      ...mappings.map((m, idx) =>
        prisma.tbDsFunctionColumnMapping.create({
          data: {
            func_id:     functionId,
            col_id:      m.colId,
            use_purps_cn: m.purpose?.trim() || null,
            sort_ordr:   idx + 1,
          },
        })
      ),
      prisma.tbDsDesignChange.create({
        data: {
          prjct_id:      projectId,
          ref_tbl_nm:    "tb_ds_function_column_mapping",
          ref_id:        functionId,
          chg_type_code: "UPDATE",
          chg_rsn_cn:    "컬럼 매핑 저장",
          snapshot_data: {
            funcId:    functionId,
            displayId: existing.func_display_id,
            mappingCount: mappings.length,
            savedAt:   new Date().toISOString(),
          },
          chg_mber_id: auth.mberId,
        },
      }),
    ]);

    return apiSuccess({ funcId: functionId, saved: mappings.length });
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/functions/${functionId}/column-mappings] DB 오류:`, err);
    return apiError("DB_ERROR", "컬럼 매핑 저장에 실패했습니다.", 500);
  }
}
