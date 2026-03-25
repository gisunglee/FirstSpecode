/**
 * POST /api/projects/[id]/ai-tasks/[taskId]/cancel — AI 태스크 강제 취소 (FID-00201)
 *
 * IN_PROGRESS 상태에서 5분 초과된 좀비 태스크를 FAILED로 강제 종료
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
