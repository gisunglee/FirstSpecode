/**
 * POST /api/projects/[id]/ai-tasks/[taskId]/retry — AI 태스크 재요청 (FID-00184)
 *
 * FAILED/REJECTED/TIMEOUT 상태의 태스크를 복사하여 새 PENDING 태스크 생성
 * parent_task_id로 이력 연결
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; taskId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
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

  try {
    const task = await prisma.tbAiTask.findUnique({
      where: { ai_task_id: taskId },
    });

    if (!task || task.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "AI 태스크를 찾을 수 없습니다.", 404);
    }

    // FAILED / REJECTED / TIMEOUT 상태만 재요청 가능
    if (!["FAILED", "REJECTED", "TIMEOUT"].includes(task.task_sttus_code)) {
      return apiError("VALIDATION_ERROR", "현재 상태에서는 재요청할 수 없습니다.", 400);
    }

    // 기존 태스크의 유형·코멘트·스냅샷을 그대로 복사하여 새 PENDING 태스크 생성
    const newTask = await prisma.tbAiTask.create({
      data: {
        prjct_id:          projectId,
        ref_ty_code:       task.ref_ty_code,
        ref_id:            task.ref_id,
        task_ty_code:      task.task_ty_code,
        coment_cn:         task.coment_cn,
        req_snapshot_data: task.req_snapshot_data ?? {},
        parent_task_id:    taskId,
        retry_cnt:         (task.retry_cnt ?? 0) + 1,  // 재시도할 때마다 +1
        req_mber_id:       auth.mberId,
        task_sttus_code:   "PENDING",
      },
    });

    return apiSuccess({ taskId: newTask.ai_task_id, status: "PENDING", parentTaskId: taskId }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/ai-tasks/${taskId}/retry] DB 오류:`, err);
    return apiError("DB_ERROR", "재요청 처리 중 오류가 발생했습니다.", 500);
  }
}
