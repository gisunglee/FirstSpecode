/**
 * GET  /api/projects/[id]/ai-tasks — AI 태스크 목록 조회 (FID-00182)
 * POST /api/projects/[id]/ai-tasks — AI 태스크 생성 (FID-00185)
 *
 * GET Query:
 *   status?   — PENDING|IN_PROGRESS|DONE|APPLIED|REJECTED|FAILED|TIMEOUT
 *   taskType? — INSPECT|DESIGN|IMPLEMENT|MOCKUP|IMPACT|CUSTOM
 *   refType?  — AREA|FUNCTION
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: AI 태스크 목록 조회 ─────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;
  const url      = new URL(request.url);
  const status   = url.searchParams.get("status")   ?? undefined;
  const taskType = url.searchParams.get("taskType") ?? undefined;
  const refType  = url.searchParams.get("refType")  ?? undefined;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const tasks = await prisma.tbAiTask.findMany({
      where: {
        prjct_id: projectId,
        ...(status   ? { task_sttus_code: status }   : {}),
        ...(taskType ? { task_ty_code:    taskType }  : {}),
        ...(refType  ? { ref_ty_code:     refType }   : {}),
      },
      orderBy: { req_dt: "desc" },
    });

    // 대상 이름 조인 — ref_ty_code 에 따라 Area 또는 Function 조회
    const areaIds    = tasks.filter((t) => t.ref_ty_code === "AREA")    .map((t) => t.ref_id);
    const functionIds = tasks.filter((t) => t.ref_ty_code === "FUNCTION").map((t) => t.ref_id);

    const [areas, functions] = await Promise.all([
      areaIds.length
        ? prisma.tbDsArea.findMany({
            where:  { area_id: { in: areaIds } },
            select: { area_id: true, area_nm: true, area_display_id: true },
          })
        : [],
      functionIds.length
        ? prisma.tbDsFunction.findMany({
            where:  { func_id: { in: functionIds } },
            select: { func_id: true, func_nm: true, func_display_id: true },
          })
        : [],
    ]);

    const areaMap    = new Map(areas.map((a) => [a.area_id,     { name: a.area_nm,     displayId: a.area_display_id }]));
    const functionMap = new Map(functions.map((f) => [f.func_id, { name: f.func_nm,     displayId: f.func_display_id }]));

    const now = Date.now();
    const FIVE_MIN_MS = 5 * 60 * 1000;

    // 요청자 이름 조회 (TbAiTask 에 reqMber 관계가 정의되지 않은 경우를 대비해 수동 조회)
    const mberIds = Array.from(new Set(tasks.map(t => t.req_mber_id).filter(Boolean))) as string[];
    const members = mberIds.length 
      ? await prisma.tbCmMember.findMany({
          where: { mber_id: { in: mberIds } },
          select: { mber_id: true, mber_nm: true },
        })
      : [];
    const memberMap = new Map(members.map(m => [m.mber_id, m.mber_nm]));

    const items = tasks.map((t) => {
      const refInfo = t.ref_ty_code === "AREA"
        ? areaMap.get(t.ref_id)
        : functionMap.get(t.ref_id);

      // IN_PROGRESS 상태에서 5분 초과 여부 계산 (강제 취소 버튼 노출 플래그)
      const isZombie =
        t.task_sttus_code === "IN_PROGRESS" &&
        now - t.req_dt.getTime() > FIVE_MIN_MS;

      return {
        taskId:      t.ai_task_id,
        taskType:    t.task_ty_code,
        refType:     t.ref_ty_code,
        refId:       t.ref_id,
        refName:     refInfo?.name     ?? "알 수 없음",
        refDisplayId: refInfo?.displayId ?? "",
        status:      t.task_sttus_code,
        comment:     t.coment_cn ?? "",
        resultCn:    t.result_cn ?? "",
        requestedAt: t.req_dt.toISOString(),
        completedAt: t.compl_dt?.toISOString() ?? null,
        isZombie,         // 5분 초과 IN_PROGRESS
        elapsedMs:   t.compl_dt ? (t.compl_dt.getTime() - t.req_dt.getTime()) : (now - t.req_dt.getTime()),
        reqMberName: t.req_mber_id ? (memberMap.get(t.req_mber_id) ?? "—") : "—",
        retryCnt:    t.retry_cnt ?? 0,
        execAvlblDt: t.exec_avlbl_dt?.toISOString() ?? null,
      };
    });

    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/ai-tasks] DB 오류:`, err);
    return apiError("DB_ERROR", "AI 태스크 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: AI 태스크 생성 ────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

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

  const { refTypeCode, refId, taskTypeCode, comment } = body as {
    refTypeCode?:  string;
    refId?:        string;
    taskTypeCode?: string;
    comment?:      string;
  };

  if (!refTypeCode || !["AREA", "FUNCTION"].includes(refTypeCode)) {
    return apiError("VALIDATION_ERROR", "refTypeCode는 AREA 또는 FUNCTION이어야 합니다.", 400);
  }
  if (!refId) {
    return apiError("VALIDATION_ERROR", "refId가 필요합니다.", 400);
  }
  if (!taskTypeCode || !["INSPECT", "DESIGN", "IMPLEMENT", "MOCKUP", "IMPACT", "CUSTOM"].includes(taskTypeCode)) {
    return apiError("VALIDATION_ERROR", "요청 유형을 선택해 주세요.", 400);
  }

  try {
    // 대상 엔티티 존재 확인 + 스냅샷 데이터 수집
    let snapshotData: object = { refId };

    if (refTypeCode === "AREA") {
      const area = await prisma.tbDsArea.findUnique({ where: { area_id: refId } });
      if (!area || area.prjct_id !== projectId) {
        return apiError("NOT_FOUND", "대상 영역을 찾을 수 없습니다.", 404);
      }
      snapshotData = { areaId: area.area_id, areaName: area.area_nm, areaType: area.area_ty_code, areaDesc: area.area_dc };
    } else {
      const fn = await prisma.tbDsFunction.findUnique({ where: { func_id: refId } });
      if (!fn || fn.prjct_id !== projectId) {
        return apiError("NOT_FOUND", "대상 기능을 찾을 수 없습니다.", 404);
      }
      snapshotData = { funcId: fn.func_id, funcName: fn.func_nm, funcType: fn.func_ty_code, funcDesc: fn.func_dc };
    }

    // 현재 버전은 PENDING 상태로 생성 (AI 파이프라인 미연동)
    const task = await prisma.tbAiTask.create({
      data: {
        prjct_id:         projectId,
        ref_ty_code:      refTypeCode,
        ref_id:           refId,
        task_ty_code:     taskTypeCode,
        coment_cn:        comment?.trim() || null,
        req_snapshot_data: snapshotData,
        req_mber_id:      auth.mberId,
        task_sttus_code:  "PENDING",
        retry_cnt:        3,
      },
    });

    return apiSuccess({ taskId: task.ai_task_id, status: "PENDING" }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/ai-tasks] DB 오류:`, err);
    return apiError("DB_ERROR", "요청 처리 중 오류가 발생했습니다.", 500);
  }
}
