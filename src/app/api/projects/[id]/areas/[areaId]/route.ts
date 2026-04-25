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
import { requirePermission } from "@/lib/requirePermission";
import { requireAuth } from "@/lib/requireAuth";
import {
  hasPermission, isRoleCode, isJobCode,
  type RoleCode, type JobCode,
} from "@/lib/permissions";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; areaId: string }> };

/**
 * 영역 수정/삭제 권한 게이트.
 *
 * 영역 자체에는 담당자 컬럼이 없어 부모 화면(scrn_id)의 담당자를 영역 담당자로 간주.
 *
 * 통과 조건 (OR):
 *   ① permissions 매트릭스 "requirement.update" — OWNER/ADMIN 역할 또는 PM/PL 직무
 *   ② 본인이 부모 화면의 담당자(parent screen.asign_mber_id)
 *
 * 영역에 부모 화면이 없으면(scrn_id null) 매트릭스 통과만 허용.
 */
async function requireAreaWrite(
  request: NextRequest,
  projectId: string,
  areaId: string
): Promise<{ mberId: string } | Response> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where:  { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
    select: { role_code: true, job_title_code: true, mber_sttus_code: true },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "프로젝트 멤버가 아닙니다.", 403);
  }

  const role: RoleCode | null = isRoleCode(membership.role_code) ? membership.role_code : null;
  const job:  JobCode  | null = isJobCode(membership.job_title_code) ? membership.job_title_code : null;

  const matrixOK = hasPermission(
    { role, job, plan: "FREE", systemRole: null },
    "requirement.update"
  );
  if (matrixOK) return { mberId: auth.mberId };

  // 부모 화면의 담당자인지 확인
  const target = await prisma.tbDsArea.findUnique({
    where:   { area_id: areaId },
    include: { screen: { select: { asign_mber_id: true } } },
  });
  if (!target || target.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "영역을 찾을 수 없습니다.", 404);
  }
  const parentAssigneeId = target.screen?.asign_mber_id ?? null;
  if (parentAssigneeId !== auth.mberId) {
    return apiError("FORBIDDEN", "이 영역을 수정할 권한이 없습니다.", 403);
  }

  return { mberId: auth.mberId };
}

// ─── GET: 영역 상세 조회 ─────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, areaId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    const [area, aiTaskRows, implSnapshotRows] = await Promise.all([
      prisma.tbDsArea.findUnique({
        where:   { area_id: areaId },
        include: {
          screen: {
            select: {
              scrn_id: true, scrn_nm: true, scrn_display_id: true, unit_work_id: true,
              // 영역 자체에는 담당자가 없어 부모 화면의 담당자를 영역 담당자로 간주.
              // 프론트에서 [삭제]/[저장] 버튼 노출 판정에 사용.
              asign_mber_id: true,
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
      // IMPLEMENT — 스냅샷 경유: 이 영역이 포함된 구현요청 태스크 조회
      prisma.tbSpImplSnapshot.findMany({
        where: { ref_tbl_nm: "tb_ds_area", ref_id: areaId },
        select: { ai_task_id: true },
        orderBy: { creat_dt: "desc" },
        distinct: ["ai_task_id"],
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

    // IMPLEMENT — 스냅샷에서 찾은 ai_task_id로 최신 태스크 1건 조회
    if (!aiTasks["IMPLEMENT"] && implSnapshotRows.length > 0) {
      const implTask = await prisma.tbAiTask.findFirst({
        where: {
          ai_task_id:   { in: implSnapshotRows.map((s) => s.ai_task_id) },
          task_ty_code: "IMPLEMENT",
        },
        orderBy: { req_dt: "desc" },
      });
      if (implTask) {
        aiTasks["IMPLEMENT"] = { aiTaskId: implTask.ai_task_id, status: implTask.task_sttus_code };
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
      // 부모 화면의 담당자 — 프론트 권한 판정에 사용 (영역 자체 담당자 컬럼이 없으므로)
      screenAssigneeId:  area.screen?.asign_mber_id ?? null,
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
  const { id: projectId, areaId } = await params;

  // OWNER/ADMIN 역할 OR PM/PL 직무 OR 본인이 부모 화면 담당자만 수정 가능
  const gate = await requireAreaWrite(request, projectId, areaId);
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { screenId, name, type, description, sortOrder, layoutData, commentCn, saveHistory, displayId } = body as {
    screenId?:    string;
    name?:        string;
    type?:        string;
    description?: string;
    sortOrder?:   number;
    layoutData?:  string;
    commentCn?:   string;
    saveHistory?: boolean;
    displayId?:   string;
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
          area_display_id: displayId?.trim() || existing.area_display_id,
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
            displayId: displayId?.trim() || existing.area_display_id,
            name:      name.trim(),
            type:      type || "GRID",
          },
          chg_mber_id: gate.mberId,
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
            chg_mber_id: gate.mberId,
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
  const { id: projectId, areaId } = await params;
  const url            = new URL(request.url);
  const deleteChildren = url.searchParams.get("deleteChildren") !== "false"; // 기본 true

  // OWNER/ADMIN 역할 OR PM/PL 직무 OR 본인이 부모 화면 담당자만 삭제 가능
  const gate = await requireAreaWrite(request, projectId, areaId);
  if (gate instanceof Response) return gate;

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
            chg_mber_id: gate.mberId,
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
            chg_mber_id: gate.mberId,
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
