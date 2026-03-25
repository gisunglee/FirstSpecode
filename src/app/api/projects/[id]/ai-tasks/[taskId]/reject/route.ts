/**
 * POST /api/projects/[id]/ai-tasks/[taskId]/reject — AI 결과 반려 (FID-00188)
 *
 * DONE 상태의 태스크를 REJECTED로 변경하고 반려 사유 저장
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
