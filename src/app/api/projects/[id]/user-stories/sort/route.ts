/**
 * PUT /api/projects/[id]/user-stories/sort — 사용자스토리 순서 일괄 변경 (FID-00128)
 *
 * Body: { orders: [{storyId, sortOrder}][] }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSpecManager } from "@/lib/specContentWritePolicy";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { userStorySortSchema } from "@/lib/specContentSchemas";

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  // 요구사항 편집 매트릭스와 동일 게이트 — OWNER/ADMIN 역할 OR PM/PL 직무
  // (다건 재정렬이라 개별 스토리의 담당자 조건은 적용하지 않음 — requirements/sort와 동일 관례)
  const gate = await requireSpecManager(request, projectId);
  if (gate instanceof Response) return gate;

  const parsed = await parseJsonBody(request, userStorySortSchema);
  if (parsed instanceof Response) return parsed;
  const { orders } = parsed.data;

  try {
    // 스토리가 해당 프로젝트에 속하는지 확인 후 sort_ordr 일괄 갱신
    await prisma.$transaction(
      orders.map(({ storyId, sortOrder }) =>
        prisma.tbRqUserStory.updateMany({
          where: {
            story_id: storyId,
            requirement: { prjct_id: projectId },
          },
          data: { sort_ordr: sortOrder, mdfcn_mber_id: gate.mberId, mdfcn_dt: new Date() },
        })
      )
    );

    return apiSuccess({ updated: orders.length });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/user-stories/sort] DB 오류:`, err);
    return apiError("DB_ERROR", "순서 변경 중 오류가 발생했습니다.", 500);
  }
}
