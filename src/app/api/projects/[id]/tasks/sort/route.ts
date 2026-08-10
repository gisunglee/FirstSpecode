/**
 * PUT /api/projects/[id]/tasks/sort — 과업 순서 일괄 변경 (FID-00128, 기획 트리 드래그앤드롭)
 *
 * Body: { taskIds: string[] } — 드래그 후 순서대로 나열된 taskId 배열
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSpecManager } from "@/lib/specContentWritePolicy";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { taskSortSchema } from "@/lib/specContentSchemas";

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requireSpecManager(request, projectId);
  if (gate instanceof Response) return gate;

  const parsed = await parseJsonBody(request, taskSortSchema);
  if (parsed instanceof Response) return parsed;
  const { taskIds } = parsed.data;

  try {
    await prisma.$transaction(
      taskIds.map((taskId, idx) =>
        prisma.tbRqTask.updateMany({
          where: { task_id: taskId, prjct_id: projectId },
          data:  { sort_ordr: idx + 1, mdfcn_mber_id: gate.mberId, mdfcn_dt: new Date() },
        })
      )
    );

    return apiSuccess({ updated: taskIds.length });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/tasks/sort] DB 오류:`, err);
    return apiError("DB_ERROR", "순서 변경 중 오류가 발생했습니다.", 500);
  }
}
