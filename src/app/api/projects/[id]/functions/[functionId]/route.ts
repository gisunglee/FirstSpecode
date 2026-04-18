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
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, functionId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const [fn, aiTaskRows, implSnapshotRows] = await Promise.all([
      prisma.tbDsFunction.findUnique({
        where:   { func_id: functionId },
        include: {
          area: {
            select: {
              area_id:         true,
              area_nm:         true,
              area_display_id: true,
              screen: {
                select: {
                  scrn_id:         true,
                  scrn_nm:         true,
                  scrn_display_id: true,
                  unitWork: {
                    select: {
                      unit_work_id:         true,
                      unit_work_display_id: true,
                      unit_work_nm:         true,
                      unit_work_dc:         true,
                      bgng_de:              true,
                      end_de:               true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      // DESIGN/INSPECT/IMPACT — 기존: ref_id = functionId 직접 조회
      prisma.tbAiTask.findMany({
        where: {
          prjct_id:     projectId,
          ref_ty_code:  "FUNCTION",
          ref_id:       functionId,
          task_ty_code: { in: ["DESIGN", "INSPECT", "IMPACT"] },
        },
        orderBy: { req_dt: "desc" },
      }),
      // IMPLEMENT — 스냅샷 경유: 이 기능이 포함된 구현요청 태스크 조회
      // tb_sp_impl_snapshot에 기능별 레코드가 있으므로 해당 ai_task_id로 역추적
      prisma.tbSpImplSnapshot.findMany({
        where: { ref_tbl_nm: "tb_ds_function", ref_id: functionId },
        select: { ai_task_id: true },
        orderBy: { creat_dt: "desc" },
        distinct: ["ai_task_id"],
      }),
    ]);

    if (!fn || fn.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "기능을 찾을 수 없습니다.", 404);
    }

    // 태스크 타입별 최신 1건만 추출
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

    return apiSuccess({
      funcId:         fn.func_id,
      displayId:      fn.func_display_id,
      name:           fn.func_nm,
      description:    fn.func_dc ?? "",
      commentCn:        fn.coment_cn ?? "",
      type:           fn.func_ty_code,
      priority:       fn.priort_code,
      complexity:     fn.cmplx_code,
      effort:         fn.efrt_val ?? "",
      assignMemberId: fn.asign_mber_id ?? null,
      implStartDate:  fn.impl_bgng_de ?? "",
      implEndDate:    fn.impl_end_de ?? "",
      sortOrder:      fn.sort_ordr,
      areaId:            fn.area_id ?? null,
      areaName:          fn.area?.area_nm ?? "미분류",
      areaDisplayId:     fn.area?.area_display_id ?? null,
      screenId:          fn.area?.screen?.scrn_id ?? null,
      screenName:        fn.area?.screen?.scrn_nm ?? "미분류",
      screenDisplayId:   fn.area?.screen?.scrn_display_id ?? null,
      unitWorkId:        fn.area?.screen?.unitWork?.unit_work_id ?? null,
      unitWorkDisplayId: fn.area?.screen?.unitWork?.unit_work_display_id ?? null,
      unitWorkName:      fn.area?.screen?.unitWork?.unit_work_nm ?? "미분류",
      // 단위업무 기간 — 기능 구현 기간 검증용
      unitWorkStartDate: fn.area?.screen?.unitWork?.bgng_de ?? null,
      unitWorkEndDate:   fn.area?.screen?.unitWork?.end_de ?? null,
      // 단위업무 설명 — 컬럼 매핑 팝업 TABLE_SCRIPT 자동 선택에 사용
      unitWorkDc:        fn.area?.screen?.unitWork?.unit_work_dc ?? "",
      aiTasks,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/functions/${functionId}] DB 오류:`, err);
    return apiError("DB_ERROR", "기능 조회에 실패했습니다.", 500);
  }
}

// ─── PUT: 기능 수정 + 이력 ────────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
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
    areaId, name, type, description, commentCn,
    priority, complexity, effort,
    assignMemberId, implStartDate, implEndDate, sortOrder, saveHistory,
  } = body as {
    areaId?:           string;
    name?:             string;
    type?:             string;
    description?:      string;
    commentCn?:        string;
    priority?:         string;
    complexity?:       string;
    effort?:           string;
    assignMemberId?:   string;
    implStartDate?:    string;
    implEndDate?:      string;
    sortOrder?:        number;
    saveHistory?:      boolean;
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

    const newDescription = description?.trim() || null;
    const oldDescription = existing.func_dc ?? null;

    await prisma.$transaction([
      prisma.tbDsFunction.update({
        where: { func_id: functionId },
        data: {
          // area_id: 명시적으로 전달된 경우만 변경
          ...(areaId !== undefined
            ? { area: areaId ? { connect: { area_id: areaId } } : { disconnect: true } }
            : {}),
          func_nm:       name?.trim() || existing.func_nm,
          func_ty_code:  type || existing.func_ty_code,
          func_dc:       description !== undefined ? newDescription : existing.func_dc,
          coment_cn:     commentCn !== undefined ? (commentCn.trim() || null) : existing.coment_cn,
          priort_code:   priority || existing.priort_code,
          cmplx_code:    complexity || existing.cmplx_code,
          efrt_val:      effort !== undefined ? (effort?.trim() || null) : existing.efrt_val,
          asign_mber_id: assignMemberId !== undefined ? (assignMemberId || null) : existing.asign_mber_id,
          impl_bgng_de:  implStartDate !== undefined ? (implStartDate || null) : existing.impl_bgng_de,
          impl_end_de:   implEndDate !== undefined ? (implEndDate || null) : existing.impl_end_de,
          sort_ordr:     sortOrder ?? existing.sort_ordr,
          mdfcn_dt:      new Date(),
        },
      }),
      prisma.tbDsDesignChange.create({
        data: {
          prjct_id:      projectId,
          ref_tbl_nm:    "tb_ds_function",
          ref_id:        functionId,
          chg_type_code: "UPDATE",
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
      // 설명 변경 이력 — tb_ds_design_change에 before/after JSON으로 저장
      ...(saveHistory ? [
        prisma.tbDsDesignChange.create({
          data: {
            prjct_id:      projectId,
            ref_tbl_nm:    "tb_ds_function",
            ref_id:        functionId,
            chg_type_code: "UPDATE",
            chg_rsn_cn:    "기능 설명",
            snapshot_data: {
              before: oldDescription,
              after:  newDescription,
            },
            chg_mber_id: auth.mberId,
          },
        }),
      ] : []),
    ]);

    return apiSuccess({ funcId: functionId });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/functions/${functionId}] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}

// ─── DELETE: 기능 삭제 + 이력 ───────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
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

    // 삭제 + 설계 변경 이력 (트랜잭션)
    await prisma.$transaction([
      prisma.tbDsFunction.delete({ where: { func_id: functionId } }),
      prisma.tbDsDesignChange.create({
        data: {
          prjct_id:      projectId,
          ref_tbl_nm:    "tb_ds_function",
          ref_id:        functionId,
          chg_type_code: "DELETE",
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
