/**
 * GET    /api/projects/[id]/ai-tasks/[taskId] — AI 태스크 상세 조회 (FID-00186)
 * PATCH  /api/projects/[id]/ai-tasks/[taskId] — 상태 직접 수정
 * DELETE /api/projects/[id]/ai-tasks/[taskId] — AI 태스크 삭제
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; taskId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, taskId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const task = await prisma.tbAiTask.findUnique({
      where: { ai_task_id: taskId },
    });

    if (!task || task.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "AI 태스크를 찾을 수 없습니다.", 404);
    }

    // 대상 이름 조회
    let refName    = "알 수 없음";
    let refDisplayId = "";

    if (task.ref_ty_code === "AREA") {
      const area = await prisma.tbDsArea.findUnique({
        where:  { area_id: task.ref_id },
        select: { area_nm: true, area_display_id: true },
      });
      refName    = area?.area_nm        ?? refName;
      refDisplayId = area?.area_display_id ?? "";
    } else if (task.ref_ty_code === "FUNCTION") {
      const fn = await prisma.tbDsFunction.findUnique({
        where:  { func_id: task.ref_id },
        select: { func_nm: true, func_display_id: true },
      });
      refName    = fn?.func_nm        ?? refName;
      refDisplayId = fn?.func_display_id ?? "";
    }

    // 요청자 이름 조회
    let reqMberName = "시스템";
    if (task.req_mber_id) {
      const mber = await prisma.tbCmMember.findUnique({
        where:  { mber_id: task.req_mber_id },
        select: { mber_nm: true },
      });
      reqMberName = mber?.mber_nm ?? "알 수 없음";
    }

    // 첨부파일 개수 — 다이얼로그의 "첨부 자료 보기" 버튼 노출 판단용
    // count 만 필요하므로 findMany 대신 count 쿼리로 페이로드·IO 최소화
    const attachmentCount = await prisma.tbCmAttachFile.count({
      where: { ref_tbl_nm: "tb_ai_task", ref_id: taskId },
    });

    const now = Date.now();
    const FIVE_MIN_MS = 5 * 60 * 1000;

    return apiSuccess({
      taskId:       task.ai_task_id,
      taskType:     task.task_ty_code,
      refType:      task.ref_ty_code,
      refId:        task.ref_id,
      refName,
      refDisplayId,
      status:       task.task_sttus_code,
      comment:      task.coment_cn      ?? "",
      reqCn:        task.req_cn         ?? "",
      resultCn:     task.result_cn      ?? "",
      rejectReason: task.reject_rsn_cn  ?? "",
      requestedAt:  task.req_dt.toISOString(),
      completedAt:  task.compl_dt?.toISOString() ?? null,
      appliedAt:    task.apply_dt?.toISOString()  ?? null,
      reqMberId:    task.req_mber_id,
      reqMberName,
      myMberId:     auth.mberId,
      myRole:       membership.role_code,
      execAvlblDt:  task.exec_avlbl_dt?.toISOString() ?? null,
      retryCnt:     task.retry_cnt,
      parentTaskId: task.parent_task_id,
      isZombie:
        task.task_sttus_code === "IN_PROGRESS" &&
        now - task.req_dt.getTime() > FIVE_MIN_MS,
      elapsedMs: now - task.req_dt.getTime(),
      attachmentCount,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/ai-tasks/${taskId}] DB 오류:`, err);
    return apiError("DB_ERROR", "AI 태스크 조회에 실패했습니다.", 500);
  }
}

// ── PATCH: 상태 직접 수정 ─────────────────────────────────────────────────────

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, taskId } = await params;

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

  const { status } = body as { status?: string };
  // APPLIED는 "결과 반영" 프로세스가 폐지되어 더 이상 수동 전환 불가
  // (기존 DB에 APPLIED 레코드는 그대로 남을 수 있으나, 새 전환은 허용하지 않음)
  const VALID_STATUSES = ["PENDING", "IN_PROGRESS", "DONE", "REJECTED", "FAILED", "TIMEOUT"];
  if (!status || !VALID_STATUSES.includes(status)) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 상태값입니다.", 400);
  }

  try {
    const task = await prisma.tbAiTask.findUnique({ where: { ai_task_id: taskId } });
    if (!task || task.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "AI 태스크를 찾을 수 없습니다.", 404);
    }

    await prisma.tbAiTask.update({
      where: { ai_task_id: taskId },
      data:  { task_sttus_code: status },
    });

    return apiSuccess({ taskId, status });
  } catch (err) {
    console.error(`[PATCH /api/projects/${projectId}/ai-tasks/${taskId}] DB 오류:`, err);
    return apiError("DB_ERROR", "상태 수정에 실패했습니다.", 500);
  }
}

// ── DELETE: AI 태스크 삭제 ────────────────────────────────────────────────────

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, taskId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM"]);
  if (roleCheck) return roleCheck;

  try {
    const task = await prisma.tbAiTask.findUnique({ where: { ai_task_id: taskId } });
    if (!task || task.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "AI 태스크를 찾을 수 없습니다.", 404);
    }

    await prisma.tbAiTask.delete({ where: { ai_task_id: taskId } });

    return apiSuccess({ taskId, deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/ai-tasks/${taskId}] DB 오류:`, err);
    return apiError("DB_ERROR", "삭제에 실패했습니다.", 500);
  }
}
