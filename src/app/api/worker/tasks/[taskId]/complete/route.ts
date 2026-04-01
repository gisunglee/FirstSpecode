/**
 * POST /api/worker/tasks/[taskId]/complete — AI 태스크 처리 완료
 *
 * 역할:
 *   - 태스크 상태를 IN_PROGRESS → DONE(성공) 또는 FAILED(실패)로 전환
 *   - AI 처리 결과(result_cn)를 저장하고 완료 시각(compl_dt)을 기록
 *   - IN_PROGRESS 상태가 아닌 경우 409 반환
 *
 * 인증:
 *   X-Worker-Key 헤더 필수
 *
 * Body:
 *   {
 *     status:   "DONE" | "FAILED"   — 처리 결과 상태
 *     resultCn: string              — AI 결과 내용 (마크다운)
 *   }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireWorkerAuth } from "../../../_lib/auth";

type RouteParams = { params: Promise<{ taskId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  // 워커 인증 확인
  const authError = requireWorkerAuth(request);
  if (authError) return authError;

  const { taskId } = await params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { status, resultCn } = body as { status?: string; resultCn?: string };

  // status는 DONE 또는 FAILED만 허용
  if (!status || !["DONE", "FAILED"].includes(status)) {
    return apiError("VALIDATION_ERROR", "status는 DONE 또는 FAILED여야 합니다.", 400);
  }

  if (status === "DONE" && !resultCn?.trim()) {
    return apiError("VALIDATION_ERROR", "DONE 상태는 resultCn이 필요합니다.", 400);
  }

  try {
    const task = await prisma.tbAiTask.findUnique({
      where:  { ai_task_id: taskId },
      select: { ai_task_id: true, task_sttus_code: true },
    });

    if (!task) {
      return apiError("NOT_FOUND", "AI 태스크를 찾을 수 없습니다.", 404);
    }

    // IN_PROGRESS 상태에서만 완료 처리 가능
    if (task.task_sttus_code !== "IN_PROGRESS") {
      return apiError(
        "CONFLICT",
        `현재 상태(${task.task_sttus_code})에서는 완료 처리할 수 없습니다. IN_PROGRESS 상태여야 합니다.`,
        409
      );
    }

    await prisma.tbAiTask.update({
      where: { ai_task_id: taskId },
      data: {
        task_sttus_code: status,
        result_cn:       resultCn?.trim() ?? null,
        compl_dt:        new Date(),
      },
    });

    return apiSuccess({ taskId, status, completedAt: new Date().toISOString() });
  } catch (err) {
    console.error(`[POST /api/worker/tasks/${taskId}/complete] DB 오류:`, err);
    return apiError("DB_ERROR", "태스크 완료 처리에 실패했습니다.", 500);
  }
}
