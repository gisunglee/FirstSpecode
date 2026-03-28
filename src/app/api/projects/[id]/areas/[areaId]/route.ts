/**
 * GET    /api/projects/[id]/areas/[areaId] — 영역 상세 조회 (FID-00153)
 * PUT    /api/projects/[id]/areas/[areaId] — 영역 수정 + 이력 (FID-00154)
 * DELETE /api/projects/[id]/areas/[areaId] — 영역 삭제 + 이력 (FID-00166)
 *
 * DELETE Query: deleteChildren=true|false (기본 true)
 *   - true:  하위 기능 전체 삭제
 *   - false: 영역만 삭제 (기능의 area_id NULL 처리)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; areaId: string }> };

// ─── GET: 영역 상세 조회 ─────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, areaId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const area = await prisma.tbDsArea.findUnique({
      where:   { area_id: areaId },
      include: {
        screen: { select: { scrn_id: true, scrn_nm: true, scrn_display_id: true } },
        // 하단 기능 목록 (AR-00074, FID-00163) — sort_ordr 오름차순
        functions: {
          orderBy: { sort_ordr: "asc" },
          select: {
            func_id:         true,
            func_display_id: true,
            func_nm:         true,
            func_sttus_code: true,
            priort_code:     true,
            sort_ordr:       true,
          },
        },
      },
    });

    if (!area || area.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "영역을 찾을 수 없습니다.", 404);
    }

    // 설계율(DESIGN_DONE 기준), 구현율(IMPL_DONE 기준) 계산 (AR-00073 요약)
    const total     = area.functions.length;
    const designDone = area.functions.filter((f) => f.func_sttus_code === "DESIGN_DONE" || f.func_sttus_code === "IMPL_DONE").length;
    const implDone   = area.functions.filter((f) => f.func_sttus_code === "IMPL_DONE").length;

    return apiSuccess({
      areaId:      area.area_id,
      displayId:   area.area_display_id,
      name:        area.area_nm,
      description: area.area_dc ?? "",
      type:        area.area_ty_code,
      sortOrder:   area.sort_ordr,
      layoutData:  area.layer_data_dc ?? null,
      commentCn:   area.coment_cn ?? "",
      screenId:    area.scrn_id ?? null,
      screenName:  area.screen?.scrn_nm ?? "미분류",
      screenDisplayId: area.screen?.scrn_display_id ?? null,
      excalidrawData:  area.excaldw_data ?? null,
      // 요약 정보 (AR-00073)
      summary: {
        functionCount: total,
        designRate:    total > 0 ? Math.round((designDone / total) * 100) : 0,
        implRate:      total > 0 ? Math.round((implDone / total) * 100) : 0,
      },
      // 하단 기능 목록 (AR-00074)
      functions: area.functions.map((f) => ({
        funcId:    f.func_id,
        displayId: f.func_display_id,
        name:      f.func_nm,
        status:    f.func_sttus_code,
        priority:  f.priort_code,
        sortOrder: f.sort_ordr,
      })),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/areas/${areaId}] DB 오류:`, err);
    return apiError("DB_ERROR", "영역 조회에 실패했습니다.", 500);
  }
}

// ─── PUT: 영역 수정 + 이력 ────────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, areaId } = await params;

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

  const { screenId, name, type, description, sortOrder, layoutData, commentCn, saveHistory } = body as {
    screenId?:    string;
    name?:        string;
    type?:        string;
    description?: string;
    sortOrder?:   number;
    layoutData?:  string;
    commentCn?:   string;
    saveHistory?: boolean;
  };

  if (!name?.trim()) return apiError("VALIDATION_ERROR", "영역명을 입력해 주세요.", 400);

  try {
    const existing = await prisma.tbDsArea.findUnique({ where: { area_id: areaId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "영역을 찾을 수 없습니다.", 404);
    }

    const newDescription = description?.trim() || null;

    // 수정 + 설계 변경 이력 (트랜잭션)
    await prisma.$transaction([
      prisma.tbDsArea.update({
        where: { area_id: areaId },
        data: {
          scrn_id:      screenId !== undefined ? (screenId || null) : existing.scrn_id,
          area_nm:      name.trim(),
          area_ty_code: type || "GRID",
          area_dc:      newDescription,
          sort_ordr:    sortOrder ?? existing.sort_ordr,
          layer_data_dc: layoutData !== undefined ? layoutData : existing.layer_data_dc,
          coment_cn:     commentCn  !== undefined ? (commentCn || null) : existing.coment_cn,
          mdfcn_dt:     new Date(),
        },
      }),
      prisma.tbDsDesignChange.create({
        data: {
          prjct_id:      projectId,
          ref_tbl_nm:    "tb_ds_area",
          ref_id:        areaId,
          chg_rsn_cn:    "영역 수정",
          snapshot_data: {
            areaId:    areaId,
            displayId: existing.area_display_id,
            name:      name.trim(),
            type:      type || "GRID",
          },
          chg_mber_id: auth.mberId,
        },
      }),
      // 설명 변경 이력 저장 요청 시 tb_pj_settings_history에 추가 기록
      ...(saveHistory ? [
        prisma.tbPjSettingsHistory.create({
          data: {
            prjct_id:    projectId,
            chg_mber_id: auth.mberId,
            chg_item_nm: "영역 설명",
            bfr_val_cn:  existing.area_dc ?? null,
            aftr_val_cn: newDescription,
          },
        }),
      ] : []),
    ]);

    return apiSuccess({ areaId });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/areas/${areaId}] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}

// ─── DELETE: 영역 삭제 + 이력 ───────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, areaId } = await params;
  const url            = new URL(request.url);
  const deleteChildren = url.searchParams.get("deleteChildren") !== "false"; // 기본 true

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  try {
    const existing = await prisma.tbDsArea.findUnique({ where: { area_id: areaId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "영역을 찾을 수 없습니다.", 404);
    }

    if (deleteChildren) {
      // 하위 기능 전체 삭제 후 영역 삭제 + 이력 기록
      await prisma.$transaction([
        prisma.tbDsFunction.deleteMany({ where: { area_id: areaId } }),
        prisma.tbDsArea.delete({ where: { area_id: areaId } }),
        prisma.tbDsDesignChange.create({
          data: {
            prjct_id:      projectId,
            ref_tbl_nm:    "tb_ds_area",
            ref_id:        areaId,
            chg_rsn_cn:    "영역 삭제",
            snapshot_data: {
              areaId:    areaId,
              displayId: existing.area_display_id,
              name:      existing.area_nm,
              deletedAt: new Date().toISOString(),
            },
            chg_mber_id: auth.mberId,
          },
        }),
      ]);
    } else {
      // 기능의 area_id NULL 처리 (미분류) 후 영역만 삭제 + 이력 기록
      await prisma.$transaction([
        prisma.tbDsFunction.updateMany({
          where: { area_id: areaId },
          data:  { area_id: null },
        }),
        prisma.tbDsArea.delete({ where: { area_id: areaId } }),
        prisma.tbDsDesignChange.create({
          data: {
            prjct_id:      projectId,
            ref_tbl_nm:    "tb_ds_area",
            ref_id:        areaId,
            chg_rsn_cn:    "영역 삭제 (기능 미분류 유지)",
            snapshot_data: {
              areaId:    areaId,
              displayId: existing.area_display_id,
              name:      existing.area_nm,
              deletedAt: new Date().toISOString(),
            },
            chg_mber_id: auth.mberId,
          },
        }),
      ]);
    }

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/areas/${areaId}] DB 오류:`, err);
    return apiError("DB_ERROR", "삭제 중 오류가 발생했습니다.", 500);
  }
}
