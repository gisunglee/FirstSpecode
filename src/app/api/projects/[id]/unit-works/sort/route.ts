/**
 * PUT /api/projects/[id]/unit-works/sort — 단위업무 순서 일괄 변경 (FID-00132)
 *
 * Body: { orders: [{unitWorkId, sortOrder}][] }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSpecManager } from "@/lib/specContentWritePolicy";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { unitWorkSortSchema } from "@/lib/specContentSchemas";

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requireSpecManager(request, projectId);
  if (gate instanceof Response) return gate;

  const parsed = await parseJsonBody(request, unitWorkSortSchema);
  if (parsed instanceof Response) return parsed;
  const { orders } = parsed.data;

  try {
    // 단위업무가 해당 프로젝트에 속하는지 확인 후 sort_ordr 일괄 갱신
    await prisma.$transaction(
      orders.map(({ unitWorkId, sortOrder }) =>
        prisma.tbDsUnitWork.updateMany({
          where: {
            unit_work_id: unitWorkId,
            prjct_id:     projectId,
          },
          data: { sort_ordr: sortOrder, mdfcn_mber_id: gate.mberId, mdfcn_dt: new Date() },
        })
      )
    );

    return apiSuccess({ updated: orders.length });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/unit-works/sort] DB 오류:`, err);
    return apiError("DB_ERROR", "순서 변경 중 오류가 발생했습니다.", 500);
  }
}
