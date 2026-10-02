/**
 * POST /api/projects/[id]/ai-tasks/[taskId]/cancel — AI 태스크 강제 취소 (FID-00201)
 *
 * IN_PROGRESS 상태에서 5분 초과된 좀비 태스크를 FAILED로 강제 종료
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; taskId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, taskId } = await params;

  // 권한 가드 — 역할 매트릭스(permissions.ts) 기반.
  // 결제 잠금(§1-6)·지원 세션 읽기전용·프로젝트 삭제 상태도 requirePermission 이 함께 처리한다.
  const auth = await requirePermission(request, projectId, "ai.request");
  if (auth instanceof Response) return auth;

  try {
    const task = await prisma.tbAiTask.findUnique({
      where: { ai_task_id: taskId },
    });

    if (!task || task.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "AI 태스크를 찾을 수 없습니다.", 404);
    }

    // 이미 완료된 태스크
    if (task.task_sttus_code !== "IN_PROGRESS") {
      return apiError("CONFLICT", "이미 처리가 완료된 태스크입니다.", 409);
    }

    // 5분 미경과 검증
    const FIVE_MIN_MS = 5 * 60 * 1000;
    if (Date.now() - task.req_dt.getTime() < FIVE_MIN_MS) {
      return apiError("VALIDATION_ERROR", "아직 처리 중입니다. 잠시 후 다시 시도해 주세요.", 400);
    }

    // FAILED로 강제 취소, exec_avlbl_dt = null (자동 재시도 방지)
    await prisma.tbAiTask.update({
      where: { ai_task_id: taskId },
      data: {
        task_sttus_code: "FAILED",
        result_cn:       "사용자 강제 취소 (처리 지연)",
        compl_dt:        new Date(),
        exec_avlbl_dt:   null,
      },
    });

    return apiSuccess({ taskId, status: "FAILED" });
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/ai-tasks/${taskId}/cancel] DB 오류:`, err);
    return apiError("DB_ERROR", "취소 처리 중 오류가 발생했습니다.", 500);
  }
}
