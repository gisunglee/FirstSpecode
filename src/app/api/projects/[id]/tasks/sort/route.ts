/**
 * PUT /api/projects/[id]/tasks/sort — 과업 순서 일괄 갱신 (FID-00093)
 *
 * Body: { taskIds: string[] } — 새 순서대로 정렬된 task_id 배열
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
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

  const { taskIds } = body as { taskIds?: string[] };
  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    return apiError("VALIDATION_ERROR", "taskIds 배열을 전달해 주세요.", 400);
  }

  try {
    // 배열 인덱스 순서대로 sort_ordr 일괄 갱신 — 트랜잭션 처리
    await prisma.$transaction(
      taskIds.map((taskId, idx) =>
        prisma.tbRqTask.updateMany({
          where: { task_id: taskId, prjct_id: projectId },
          data:  { sort_ordr: idx + 1 },
        })
      )
    );

    return apiSuccess({ ok: true });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/tasks/sort] DB 오류:`, err);
    return apiError("DB_ERROR", "순서 저장 중 오류가 발생했습니다.", 500);
  }
}
