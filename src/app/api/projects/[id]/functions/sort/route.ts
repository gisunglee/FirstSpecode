/**
 * PUT /api/projects/[id]/functions/sort — 기능 순서 일괄 변경 (FID-00170)
 *
 * Body: { orders: [{funcId, sortOrder}][] }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSpecManager } from "@/lib/specContentWritePolicy";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { functionSortSchema } from "@/lib/specContentSchemas";

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requireSpecManager(request, projectId);
  if (gate instanceof Response) return gate;

  const parsed = await parseJsonBody(request, functionSortSchema);
  if (parsed instanceof Response) return parsed;
  const { orders } = parsed.data;

  try {
    await prisma.$transaction(
      orders.map(({ funcId, sortOrder }) =>
        prisma.tbDsFunction.updateMany({
          where: { func_id: funcId, prjct_id: projectId },
          data:  { sort_ordr: sortOrder, mdfcn_mber_id: gate.mberId, mdfcn_dt: new Date() },
        })
      )
    );

    return apiSuccess({ updated: orders.length });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/functions/sort] DB 오류:`, err);
    return apiError("DB_ERROR", "순서 변경 중 오류가 발생했습니다.", 500);
  }
}
