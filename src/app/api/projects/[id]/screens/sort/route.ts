/**
 * PUT /api/projects/[id]/screens/sort — 화면 순서 일괄 변경 (FID-00145)
 *
 * Body: { orders: [{screenId, sortOrder}][] }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSpecManager } from "@/lib/specContentWritePolicy";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { screenSortSchema } from "@/lib/specContentSchemas";

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requireSpecManager(request, projectId);
  if (gate instanceof Response) return gate;

  const parsed = await parseJsonBody(request, screenSortSchema);
  if (parsed instanceof Response) return parsed;
  const { orders } = parsed.data;

  try {
    // 화면이 해당 프로젝트에 속하는지 확인 후 sort_ordr 일괄 갱신
    await prisma.$transaction(
      orders.map(({ screenId, sortOrder }) =>
        prisma.tbDsScreen.updateMany({
          where: { scrn_id: screenId, prjct_id: projectId },
          data:  { sort_ordr: sortOrder, mdfcn_mber_id: gate.mberId, mdfcn_dt: new Date() },
        })
      )
    );

    return apiSuccess({ updated: orders.length });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/screens/sort] DB 오류:`, err);
    return apiError("DB_ERROR", "순서 변경 중 오류가 발생했습니다.", 500);
  }
}
