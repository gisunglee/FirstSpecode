/**
 * PUT /api/projects/[id]/screens/sort — 화면 순서 일괄 변경 (FID-00145)
 *
 * Body: { orders: [{screenId, sortOrder}][] }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
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

  const { orders } = body as { orders?: { screenId: string; sortOrder: number }[] };
  if (!Array.isArray(orders) || orders.length === 0) {
    return apiError("VALIDATION_ERROR", "orders 배열이 필요합니다.", 400);
  }

  try {
    // 화면이 해당 프로젝트에 속하는지 확인 후 sort_ordr 일괄 갱신
    await prisma.$transaction(
      orders.map(({ screenId, sortOrder }) =>
        prisma.tbDsScreen.updateMany({
          where: { scrn_id: screenId, prjct_id: projectId },
          data:  { sort_ordr: sortOrder },
        })
      )
    );

    return apiSuccess({ updated: orders.length });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/screens/sort] DB 오류:`, err);
    return apiError("DB_ERROR", "순서 변경 중 오류가 발생했습니다.", 500);
  }
}
