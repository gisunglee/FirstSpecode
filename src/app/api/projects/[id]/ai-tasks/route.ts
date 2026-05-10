/**
 * GET  /api/projects/[id]/ai-tasks — AI 태스크 목록 조회 (FID-00182)
 * POST /api/projects/[id]/ai-tasks — AI 태스크 생성 (FID-00185)
 *
 * GET Query:
 *   status?   — PENDING|IN_PROGRESS|DONE|APPLIED|REJECTED|FAILED|TIMEOUT
 *   taskType? — INSPECT|DESIGN|IMPLEMENT|MOCKUP|IMPACT|CUSTOM
 *   refType?  — UNIT_WORK|AREA|FUNCTION
 *   snapshotRefId? — 스냅샷 경유 조회 (IMPLEMENT 전용: 해당 기능이 포함된 태스크)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { fetchProjectAiTasks } from "@/lib/exports/ai-tasks-data";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: AI 태스크 목록 조회 ─────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;
  const url               = new URL(request.url);
  const status            = url.searchParams.get("status")           ?? undefined;
  const taskType          = url.searchParams.get("taskType")         ?? undefined;
  const refType           = url.searchParams.get("refType")          ?? undefined;
  const refId             = url.searchParams.get("refId")            ?? undefined;
  const snapshotRefId     = url.searchParams.get("snapshotRefId")    ?? undefined;
  const snapshotRefType   = url.searchParams.get("snapshotRefType")  ?? undefined;
  const reqMberId         = url.searchParams.get("reqMberId")        ?? undefined;
  const page              = Math.max(1, parseInt(url.searchParams.get("page")     ?? "1",  10));
  const pageSize          = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "20", 10)));

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    // 데이터 조회+가공 로직은 service 로 분리 — export 라우트와 동일 결과 보장
    const { items, totalCount } = await fetchProjectAiTasks({
      projectId,
      filters: {
        status, taskType, refType, refId,
        snapshotRefId, snapshotRefType,
        reqMberId, meMberId: auth.mberId,
      },
      pagination: { page, pageSize },
    });

    return apiSuccess({
      items,
      totalCount,
      page,
      pageSize,
      pageCount: Math.ceil(totalCount / pageSize),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/ai-tasks] DB 오류:`, err);
    return apiError("DB_ERROR", "AI 태스크 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: AI 태스크 생성 ────────────────────────────────────────────────────
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
        retry_cnt:        0,
      },
    });

    return apiSuccess({ taskId: task.ai_task_id, status: "PENDING" }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/ai-tasks] DB 오류:`, err);
    return apiError("DB_ERROR", "요청 처리 중 오류가 발생했습니다.", 500);
  }
}
