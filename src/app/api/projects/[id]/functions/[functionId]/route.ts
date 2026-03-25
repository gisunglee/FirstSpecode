/**
 * GET    /api/projects/[id]/functions/[functionId] — 기능 상세 조회 (FID-00171)
 * PUT    /api/projects/[id]/functions/[functionId] — 기능 수정 + 이력 (FID-00172)
 * DELETE /api/projects/[id]/functions/[functionId] — 기능 삭제 + 이력 (FID-00179)
 *
 * DELETE: 컬럼 매핑 + AI 태스크(FUNCTION ref) 함께 삭제
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; functionId: string }> };

// ─── GET: 기능 상세 조회 ─────────────────────────────────────────────────────
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
    const fn = await prisma.tbDsFunction.findUnique({
      where:   { func_id: functionId },
      include: {
        area: { select: { area_id: true, area_nm: true, area_display_id: true } },
        // 하단 컬럼 매핑 목록 (AR-00082, FID-00178)
        columnMappings: {
          orderBy: { sort_ordr: "asc" },
          include: {
            column: {
              include: {
                table: { select: { tbl_id: true, tbl_physcl_nm: true, tbl_lgcl_nm: true } },
              },
            },
          },
        },
      },
    });

    if (!fn || fn.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "기능을 찾을 수 없습니다.", 404);
    }

    return apiSuccess({
      funcId:        fn.func_id,
      displayId:     fn.func_display_id,
      name:          fn.func_nm,
      description:   fn.func_dc ?? "",
      type:          fn.func_ty_code,
      status:        fn.func_sttus_code,
      priority:      fn.priort_code,
      complexity:    fn.cmplx_code,
      effort:        fn.efrt_val ?? "",
      assignMemberId: fn.asign_mber_id ?? null,
      implStartDate: fn.impl_bgng_de ?? "",
      implEndDate:   fn.impl_end_de ?? "",
      spec:          fn.spec_cn ?? "",
      sortOrder:     fn.sort_ordr,
      areaId:        fn.area_id ?? null,
      areaName:      fn.area?.area_nm ?? "미분류",
      areaDisplayId: fn.area?.area_display_id ?? null,
      // 컬럼 매핑 목록
      columnMappings: fn.columnMappings.map((m) => ({
        mappingId:    m.mapping_id,
        colId:        m.col_id,
        colName:      m.column.col_physcl_nm,
        colLogicalNm: m.column.col_lgcl_nm ?? "",
        tableId:      m.column.table.tbl_id,
        tableName:    m.column.table.tbl_physcl_nm,
        tableLogicalNm: m.column.table.tbl_lgcl_nm ?? "",
        purpose:      m.use_purps_cn ?? "",
        sortOrder:    m.sort_ordr,
      })),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/functions/${functionId}] DB 오류:`, err);
    return apiError("DB_ERROR", "기능 조회에 실패했습니다.", 500);
  }
}

// ─── PUT: 기능 수정 + 이력 ────────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
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

  const {
    areaId, name, type, description, priority, complexity, effort,
    assignMemberId, implStartDate, implEndDate, spec, sortOrder,
  } = body as {
    areaId?:         string;
    name?:           string;
    type?:           string;
    description?:    string;
    priority?:       string;
    complexity?:     string;
    effort?:         string;
    assignMemberId?: string;
    implStartDate?:  string;
    implEndDate?:    string;
    spec?:           string;
    sortOrder?:      number;
  };

  if (!name?.trim()) return apiError("VALIDATION_ERROR", "기능명을 입력해 주세요.", 400);

  if (implStartDate && implEndDate && implStartDate > implEndDate) {
    return apiError("VALIDATION_ERROR", "구현 종료일은 시작일 이후여야 합니다.", 400);
  }

  try {
    const existing = await prisma.tbDsFunction.findUnique({ where: { func_id: functionId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "기능을 찾을 수 없습니다.", 404);
    }

    await prisma.$transaction([
      prisma.tbDsFunction.update({
        where: { func_id: functionId },
        data: {
          area_id:       areaId !== undefined ? (areaId || null) : existing.area_id,
          func_nm:       name.trim(),
          func_ty_code:  type || "OTHER",
          func_dc:       description?.trim() || null,
          priort_code:   priority || "MEDIUM",
          cmplx_code:    complexity || "MEDIUM",
          efrt_val:      effort?.trim() || null,
          asign_mber_id: assignMemberId || null,
          impl_bgng_de:  implStartDate || null,
          impl_end_de:   implEndDate || null,
          spec_cn:       spec?.trim() || null,
          sort_ordr:     sortOrder ?? existing.sort_ordr,
          mdfcn_dt:      new Date(),
        },
      }),
      prisma.tbDsDesignChange.create({
        data: {
          prjct_id:      projectId,
          ref_tbl_nm:    "tb_ds_function",
          ref_id:        functionId,
          chg_rsn_cn:    "기능 수정",
          snapshot_data: {
            funcId:    functionId,
            displayId: existing.func_display_id,
            name:      name.trim(),
            type:      type || "OTHER",
          },
          chg_mber_id: auth.mberId,
        },
      }),
    ]);

    return apiSuccess({ funcId: functionId });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/functions/${functionId}] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}

// ─── DELETE: 기능 삭제 + 이력 ───────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
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

  try {
    const existing = await prisma.tbDsFunction.findUnique({ where: { func_id: functionId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "기능을 찾을 수 없습니다.", 404);
    }

    await prisma.$transaction([
      // 컬럼 매핑 삭제
      prisma.tbDsFunctionColumnMapping.deleteMany({ where: { func_id: functionId } }),
      // AI 태스크 삭제 (ref_ty_code='FUNCTION', ref_id=functionId)
      prisma.tbAiTask.deleteMany({
        where: { ref_ty_code: "FUNCTION", ref_id: functionId },
      }),
      // 기능 삭제
      prisma.tbDsFunction.delete({ where: { func_id: functionId } }),
      // 설계 변경 이력 기록
      prisma.tbDsDesignChange.create({
        data: {
          prjct_id:      projectId,
          ref_tbl_nm:    "tb_ds_function",
          ref_id:        functionId,
          chg_rsn_cn:    "기능 삭제",
          snapshot_data: {
            funcId:    functionId,
            displayId: existing.func_display_id,
            name:      existing.func_nm,
            deletedAt: new Date().toISOString(),
          },
          chg_mber_id: auth.mberId,
        },
      }),
    ]);

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/functions/${functionId}] DB 오류:`, err);
    return apiError("DB_ERROR", "삭제 중 오류가 발생했습니다.", 500);
  }
}
