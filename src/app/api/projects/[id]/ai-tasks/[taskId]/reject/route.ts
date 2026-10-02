/**
 * POST /api/projects/[id]/ai-tasks/[taskId]/reject — AI 결과 반려 (FID-00188)
 *
 * DONE 상태의 태스크를 REJECTED로 변경하고 반려 사유 저장
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

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { rejectReason } = body as { rejectReason?: string };
  if (!rejectReason?.trim()) {
    return apiError("VALIDATION_ERROR", "반려 사유를 입력해 주세요.", 400);
  }

  try {
    const task = await prisma.tbAiTask.findUnique({
      where: { ai_task_id: taskId },
    });

    if (!task || task.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "AI 태스크를 찾을 수 없습니다.", 404);
    }

    // 이미 처리된 태스크
    if (!["DONE"].includes(task.task_sttus_code)) {
      return apiError("CONFLICT", "이미 처리된 태스크입니다.", 409);
    }

    await prisma.tbAiTask.update({
      where: { ai_task_id: taskId },
      data: {
        task_sttus_code: "REJECTED",
        reject_rsn_cn:   rejectReason.trim(),
        compl_dt:        new Date(),
      },
    });

    return apiSuccess({ taskId, status: "REJECTED" });
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/ai-tasks/${taskId}/reject] DB 오류:`, err);
    return apiError("DB_ERROR", "반려 처리 중 오류가 발생했습니다.", 500);
  }
}
