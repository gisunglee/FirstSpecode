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
    const [area, aiTaskRows] = await Promise.all([
      prisma.tbDsArea.findUnique({
        where:   { area_id: areaId },
        include: {
          screen: {
            select: {
              scrn_id: true, scrn_nm: true, scrn_display_id: true, unit_work_id: true,
              unitWork: { select: { unit_work_display_id: true, unit_work_nm: true } },
            },
          },
          // 하단 기능 목록 (AR-00074, FID-00163) — sort_ordr 오름차순
          functions: {
            orderBy: { sort_ordr: "asc" },
            select: {
              func_id:         true,
              func_display_id: true,
              func_nm:         true,
              priort_code:     true,
              sort_ordr:       true,
            },
          },
        },
      }),
      // 영역용 AI 태스크 최신 상태 조회 (타입별 최신 1건)
      prisma.tbAiTask.findMany({
        where: {
          prjct_id:    projectId,
          ref_ty_code: "AREA",
          ref_id:      areaId,
        },
        orderBy: { req_dt: "desc" },
        select: { ai_task_id: true, task_ty_code: true, task_sttus_code: true },
      }),
    ]);

    if (!area || area.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "영역을 찾을 수 없습니다.", 404);
    }

    // 타입별 최신 1건만 추출
    const aiTasks: Record<string, { aiTaskId: string; status: string }> = {};
    for (const t of aiTaskRows) {
      if (!aiTasks[t.task_ty_code]) {
        aiTasks[t.task_ty_code] = { aiTaskId: t.ai_task_id, status: t.task_sttus_code };
      }
    }

    // 기능 수 (AR-00073 요약)
    const total = area.functions.length;

    // 기능별 진척률 조회 — tb_cm_progress에서 한번에 가져오기
    const funcIds = area.functions.map(f => f.func_id);
    let progressMap = new Map<string, { designRt: number; implRt: number; testRt: number }>();
    if (funcIds.length > 0) {
      const progressRows = await prisma.tbCmProgress.findMany({
        where: { ref_tbl_nm: "tb_ds_function", ref_id: { in: funcIds } },
        select: { ref_id: true, design_rt: true, impl_rt: true, test_rt: true },
      });
      progressMap = new Map(progressRows.map(r => [r.ref_id, {
        designRt: r.design_rt,
        implRt:   r.impl_rt,
        testRt:   r.test_rt,
      }]));
    }

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
      screenName:        area.screen?.scrn_nm ?? "미분류",
      screenDisplayId:   area.screen?.scrn_display_id ?? null,
      unitWorkId:        area.screen?.unit_work_id ?? null,
      unitWorkDisplayId: area.screen?.unitWork?.unit_work_display_id ?? null,
      unitWorkName:      area.screen?.unitWork?.unit_work_nm ?? "미분류",
      excalidrawData:  area.excaldw_data ?? null,
      aiTasks,
      // 요약 정보 (AR-00073)
      summary: {
        functionCount: total,
      },
      // 하단 기능 목록 (AR-00074)
      functions: area.functions.map((f) => {
        const prog = progressMap.get(f.func_id);
        return {
          funcId:    f.func_id,
          displayId: f.func_display_id,
          name:      f.func_nm,
          priority:  f.priort_code,
          sortOrder: f.sort_ordr,
          designRt:  prog?.designRt ?? 0,
          implRt:    prog?.implRt ?? 0,
          testRt:    prog?.testRt ?? 0,
        };
      }),
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
          chg_type_code: "UPDATE",
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
      // 설명 변경 이력 — tb_ds_design_change에 before/after JSON으로 저장
      ...(saveHistory ? [
        prisma.tbDsDesignChange.create({
          data: {
            prjct_id:      projectId,
            ref_tbl_nm:    "tb_ds_area",
            ref_id:        areaId,
            chg_type_code: "UPDATE",
            chg_rsn_cn:    "영역 설명",
            snapshot_data: {
              before: existing.area_dc ?? null,
              after:  newDescription,
            },
            chg_mber_id: auth.mberId,
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
            chg_type_code: "DELETE",
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
            chg_type_code: "DELETE",
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
