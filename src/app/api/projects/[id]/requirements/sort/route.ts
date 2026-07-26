/**
 * PUT /api/projects/[id]/requirements/sort — 요구사항 순서 일괄 변경 (FID-00101)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  // 요구사항 편집 매트릭스와 동일 게이트 — OWNER/ADMIN 역할 OR PM/PL 직무
  // (다건 재정렬이라 개별 요구사항 담당자 조건(asign_mber_id)은 적용하지 않음 —
  //  드래그 한 번에 여러 요구사항의 순서가 함께 바뀌므로 본인 담당 예외를 넣으면
  //  담당 아닌 다른 요구사항의 순서까지 바꿀 수 있게 되어 버림)
  const gate = await requirePermission(request, projectId, "requirement.update");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { orders } = body as { orders?: { requirementId: string; sortOrder: number }[] };
  if (!Array.isArray(orders) || orders.length === 0) {
    return apiError("VALIDATION_ERROR", "orders 배열이 필요합니다.", 400);
  }

  try {
    // 일괄 sort_ordr 업데이트 (트랜잭션)
    await prisma.$transaction(
      orders.map(({ requirementId, sortOrder }) =>
        prisma.tbRqRequirement.updateMany({
          where: { req_id: requirementId, prjct_id: projectId },
          data:  { sort_ordr: sortOrder },
        })
      )
    );

    return apiSuccess({ updated: orders.length });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/requirements/sort] DB 오류:`, err);
    return apiError("DB_ERROR", "순서 변경 중 오류가 발생했습니다.", 500);
  }
}
