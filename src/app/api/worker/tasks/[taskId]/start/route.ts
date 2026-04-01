/**
 * PATCH /api/worker/tasks/[taskId]/start — AI 태스크 처리 시작
 *
 * 역할:
 *   - 태스크 상태를 PENDING → IN_PROGRESS로 전환
 *   - 워커가 처리를 시작할 때 호출하여 중복 처리 방지
 *   - PENDING이 아닌 태스크 시작 시도는 409 반환
 *
 * 인증:
 *   X-Worker-Key 헤더 필수
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireWorkerAuth } from "../../../_lib/auth";

type RouteParams = { params: Promise<{ taskId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  // 워커 인증 확인
  const authError = requireWorkerAuth(request);
  if (authError) return authError;

  const { taskId } = await params;

  try {
    const task = await prisma.tbAiTask.findUnique({
      where:  { ai_task_id: taskId },
      select: { ai_task_id: true, task_sttus_code: true },
    });

    if (!task) {
      return apiError("NOT_FOUND", "AI 태스크를 찾을 수 없습니다.", 404);
    }

    // PENDING 상태인 경우에만 시작 가능
    if (task.task_sttus_code !== "PENDING") {
      return apiError(
        "CONFLICT",
        `현재 상태(${task.task_sttus_code})에서는 시작할 수 없습니다. PENDING 상태여야 합니다.`,
        409
      );
    }

    await prisma.tbAiTask.update({
      where: { ai_task_id: taskId },
      data:  { task_sttus_code: "IN_PROGRESS" },
    });

    return apiSuccess({ taskId, status: "IN_PROGRESS" });
  } catch (err) {
    console.error(`[PATCH /api/worker/tasks/${taskId}/start] DB 오류:`, err);
    return apiError("DB_ERROR", "태스크 시작 처리에 실패했습니다.", 500);
  }
}
