/**
 * GET /api/projects/[id]/ai-tasks/[taskId] — AI 태스크 상세 조회 (FID-00186)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; taskId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
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
      resultCn:     task.result_cn      ?? "",
      rejectReason: task.reject_rsn_cn  ?? "",
      requestedAt:  task.req_dt.toISOString(),
      completedAt:  task.compl_dt?.toISOString() ?? null,
      appliedAt:    task.apply_dt?.toISOString()  ?? null,
      isZombie:
        task.task_sttus_code === "IN_PROGRESS" &&
        now - task.req_dt.getTime() > FIVE_MIN_MS,
      elapsedMs: now - task.req_dt.getTime(),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/ai-tasks/${taskId}] DB 오류:`, err);
    return apiError("DB_ERROR", "AI 태스크 조회에 실패했습니다.", 500);
  }
}
