/**
 * PUT /api/projects/[id]/tasks/sort — 과업 순서 일괄 변경 (FID-00128, 기획 트리 드래그앤드롭)
 *
 * Body: { taskIds: string[] } — 드래그 후 순서대로 나열된 taskId 배열
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTaskWrite } from "@/lib/taskWriteGate";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  // 과업 등록/수정과 동일 게이트 — OWNER/ADMIN 역할 OR PM/PL 직무 OR MEMBER+옵트인
  // (다건 재정렬이라 개별 과업 담당자 조건은 적용하지 않음 — requirements/sort와 동일 관례)
  const gate = await requireTaskWrite(request, projectId);
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { taskIds } = body as { taskIds?: string[] };
  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    return apiError("VALIDATION_ERROR", "taskIds 배열이 필요합니다.", 400);
  }

  try {
    await prisma.$transaction(
      taskIds.map((taskId, idx) =>
        prisma.tbRqTask.updateMany({
          where: { task_id: taskId, prjct_id: projectId },
          data:  { sort_ordr: idx + 1 },
        })
      )
    );

    return apiSuccess({ updated: taskIds.length });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/tasks/sort] DB 오류:`, err);
    return apiError("DB_ERROR", "순서 변경 중 오류가 발생했습니다.", 500);
  }
}
