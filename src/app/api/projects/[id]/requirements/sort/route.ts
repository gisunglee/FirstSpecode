/**
 * PUT /api/projects/[id]/requirements/sort — 요구사항 순서 일괄 변경 (FID-00101)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSpecManager } from "@/lib/specContentWritePolicy";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { requirementSortSchema } from "@/lib/specContentSchemas";

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  // 요구사항 편집 매트릭스와 동일 게이트 — OWNER/ADMIN 역할 OR PM/PL 직무
  // (다건 재정렬이라 개별 요구사항 담당자 조건(asign_mber_id)은 적용하지 않음 —
  //  드래그 한 번에 여러 요구사항의 순서가 함께 바뀌므로 본인 담당 예외를 넣으면
  //  담당 아닌 다른 요구사항의 순서까지 바꿀 수 있게 되어 버림)
  const gate = await requireSpecManager(request, projectId);
  if (gate instanceof Response) return gate;

  const parsed = await parseJsonBody(request, requirementSortSchema);
  if (parsed instanceof Response) return parsed;
  const { orders } = parsed.data;

  try {
    // 일괄 sort_ordr 업데이트 (트랜잭션)
    await prisma.$transaction(
      orders.map(({ requirementId, sortOrder }) =>
        prisma.tbRqRequirement.updateMany({
          where: { req_id: requirementId, prjct_id: projectId },
          data:  { sort_ordr: sortOrder, mdfcn_mber_id: gate.mberId, mdfcn_dt: new Date() },
        })
      )
    );

    return apiSuccess({ updated: orders.length });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/requirements/sort] DB 오류:`, err);
    return apiError("DB_ERROR", "순서 변경 중 오류가 발생했습니다.", 500);
  }
}
