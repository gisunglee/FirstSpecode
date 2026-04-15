/**
 * GET    /api/projects/[id]/unit-works/[unitWorkId] — 단위업무 상세 조회 (FID-00130 조회)
 * PUT    /api/projects/[id]/unit-works/[unitWorkId] — 단위업무 수정 (FID-00130 수정)
 * DELETE /api/projects/[id]/unit-works/[unitWorkId] — 단위업무 삭제 (FID-00131)
 *
 * DELETE Query: deleteChildren=true|false (기본 true)
 *   - true:  하위 화면 전체 삭제
 *   - false: 단위업무만 삭제 (화면은 unit_work_id = null 처리)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; unitWorkId: string }> };

// ─── GET: 단위업무 상세 조회 ─────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, unitWorkId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const uw = await prisma.tbDsUnitWork.findUnique({
      where:   { unit_work_id: unitWorkId },
      include: {
        requirement: { select: { req_id: true, req_display_id: true, req_nm: true } },
        screens: {
          orderBy: { sort_ordr: "asc" },
          select: {
            scrn_id:         true,
            scrn_display_id: true,
            scrn_nm:         true,
            scrn_ty_code:    true,
            url_path:        true,
          },
        },
      },
    });

    if (!uw || uw.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "단위업무를 찾을 수 없습니다.", 404);
    }

    // AI 태스크 최신 상태 조회 (taskType별 최신 1건) + IMPLEMENT 스냅샷 경유 병렬 조회
    const [aiTasks, implSnapshotRows] = await Promise.all([
      prisma.tbAiTask.findMany({
        where:   { ref_ty_code: "UNIT_WORK", ref_id: unitWorkId },
        orderBy: { req_dt: "desc" },
      }),
      prisma.tbSpImplSnapshot.findMany({
        where: { ref_tbl_nm: "tb_ds_unit_work", ref_id: unitWorkId },
        select: { ai_task_id: true },
        orderBy: { creat_dt: "desc" },
        distinct: ["ai_task_id"],
      }),
    ]);
    // taskType별 최신 1건만 유지
    const aiTaskMap: Record<string, { aiTaskId: string; status: string }> = {};
    for (const t of aiTasks) {
      if (!aiTaskMap[t.task_ty_code]) {
        aiTaskMap[t.task_ty_code] = { aiTaskId: t.ai_task_id, status: t.task_sttus_code };
      }
    }
    // IMPLEMENT — 스냅샷에서 찾은 ai_task_id로 최신 태스크 1건 조회
    // (이 단위업무 하위 어느 계층이든 포함된 구현요청 태스크가 여기서 잡힘)
    if (!aiTaskMap["IMPLEMENT"] && implSnapshotRows.length > 0) {
      const implTask = await prisma.tbAiTask.findFirst({
        where: {
          ai_task_id:   { in: implSnapshotRows.map((s) => s.ai_task_id) },
          task_ty_code: "IMPLEMENT",
        },
        orderBy: { req_dt: "desc" },
      });
      if (implTask) {
        aiTaskMap["IMPLEMENT"] = { aiTaskId: implTask.ai_task_id, status: implTask.task_sttus_code };
      }
    }

    return apiSuccess({
      unitWorkId:     uw.unit_work_id,
      displayId:      uw.unit_work_display_id,
      name:           uw.unit_work_nm,
      description:    uw.unit_work_dc ?? "",
      comment:        (uw as unknown as Record<string, unknown>).coment_cn as string ?? "",
      assignMemberId: uw.asign_mber_id ?? null,
      startDate:      uw.bgng_de ?? null,
      endDate:        uw.end_de ?? null,
      progress:       uw.progrs_rt,
      sortOrder:      uw.sort_ordr,
      reqId:          uw.req_id,
      reqDisplayId:   uw.requirement.req_display_id,
      reqName:        uw.requirement.req_nm,
      aiTasks:        aiTaskMap,
      screens: uw.screens.map((s) => ({
        screenId:    s.scrn_id,
        displayId:   s.scrn_display_id,
        name:        s.scrn_nm,
        type:        s.scrn_ty_code,
        urlPath:     s.url_path ?? "",
      })),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/unit-works/${unitWorkId}] DB 오류:`, err);
    return apiError("DB_ERROR", "단위업무 조회에 실패했습니다.", 500);
  }
}

// ─── PUT: 단위업무 수정 ──────────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, unitWorkId } = await params;

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

  const { name, description, comment, assignMemberId, startDate, endDate, progress, sortOrder, saveHistory } = body as {
    name?:           string;
    description?:    string;
    comment?:        string;
    assignMemberId?: string;
    startDate?:      string;
    endDate?:        string;
    progress?:       number;
    sortOrder?:      number;
    saveHistory?:    boolean;
  };

  if (!name?.trim()) return apiError("VALIDATION_ERROR", "단위업무명을 입력해 주세요.", 400);
  if (progress !== undefined && (progress < 0 || progress > 100)) {
    return apiError("VALIDATION_ERROR", "진행률은 0~100 사이여야 합니다.", 400);
  }

  try {
    const existing = await prisma.tbDsUnitWork.findUnique({ where: { unit_work_id: unitWorkId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "단위업무를 찾을 수 없습니다.", 404);
    }

    const newDescription = description?.trim() || null;

    if (saveHistory) {
      // 설명 변경 이력 저장과 단위업무 수정을 트랜잭션으로 처리
      await prisma.$transaction([
        (prisma.tbDsUnitWork.update as any)({
          where: { unit_work_id: unitWorkId },
          data:  {
            unit_work_nm:  name.trim(),
            unit_work_dc:  newDescription,
            coment_cn:     comment?.trim() || null,
            asign_mber_id: assignMemberId || null,
            bgng_de:       startDate?.trim() || null,
            end_de:        endDate?.trim() || null,
            progrs_rt:     progress ?? existing.progrs_rt,
            sort_ordr:     sortOrder ?? existing.sort_ordr,
            mdfcn_dt:      new Date(),
          },
        }),
        // 설명 변경 이력 — tb_ds_design_change에 before/after JSON으로 저장
        prisma.tbDsDesignChange.create({
          data: {
            prjct_id:      projectId,
            ref_tbl_nm:    "tb_ds_unit_work",
            ref_id:        unitWorkId,
            chg_type_code: "UPDATE",
            chg_rsn_cn:    "단위업무 설명",
            snapshot_data: {
              before: existing.unit_work_dc ?? null,
              after:  newDescription,
            },
            chg_mber_id: auth.mberId,
          },
        }),
      ]);
    } else {
      await (prisma.tbDsUnitWork.update as any)({
        where: { unit_work_id: unitWorkId },
        data:  {
          unit_work_nm:  name.trim(),
          unit_work_dc:  newDescription,
          coment_cn:     comment?.trim() || null,
          asign_mber_id: assignMemberId || null,
          bgng_de:       startDate?.trim() || null,
          end_de:        endDate?.trim() || null,
          progrs_rt:     progress ?? existing.progrs_rt,
          sort_ordr:     sortOrder ?? existing.sort_ordr,
          mdfcn_dt:      new Date(),
        },
      });
    }

    return apiSuccess({ unitWorkId });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/unit-works/${unitWorkId}] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}

// ─── DELETE: 단위업무 삭제 ───────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, unitWorkId } = await params;
  const url            = new URL(request.url);
  // deleteChildren 기본 true — 기본적으로 하위 화면까지 삭제
  const deleteChildren = url.searchParams.get("deleteChildren") !== "false";

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  try {
    const existing = await prisma.tbDsUnitWork.findUnique({ where: { unit_work_id: unitWorkId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "단위업무를 찾을 수 없습니다.", 404);
    }

    if (deleteChildren) {
      // 하위 화면 전체 삭제 후 단위업무 삭제 (트랜잭션)
      await prisma.$transaction([
        prisma.tbDsScreen.deleteMany({ where: { unit_work_id: unitWorkId } }),
        prisma.tbDsUnitWork.delete({ where: { unit_work_id: unitWorkId } }),
      ]);
    } else {
      // 화면의 unit_work_id를 null로 처리 (미분류) 후 단위업무만 삭제
      await prisma.$transaction([
        prisma.tbDsScreen.updateMany({
          where: { unit_work_id: unitWorkId },
          data:  { unit_work_id: null },
        }),
        prisma.tbDsUnitWork.delete({ where: { unit_work_id: unitWorkId } }),
      ]);
    }

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/unit-works/${unitWorkId}] DB 오류:`, err);
    return apiError("DB_ERROR", "삭제 중 오류가 발생했습니다.", 500);
  }
}
