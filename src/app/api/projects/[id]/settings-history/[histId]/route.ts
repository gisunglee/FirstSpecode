/**
 * DELETE /api/projects/[id]/settings-history/[histId] — 이력 단건 삭제
 *
 * OWNER / ADMIN / PM만 삭제 가능.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; histId: string }> };

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, histId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM"]);
  if (roleCheck) return roleCheck;

  try {
    const hist = await prisma.tbPjSettingsHistory.findUnique({ where: { hist_id: histId } });
    if (!hist || hist.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "이력을 찾을 수 없습니다.", 404);
    }

    await prisma.tbPjSettingsHistory.delete({ where: { hist_id: histId } });

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/settings-history/${histId}] DB 오류:`, err);
    return apiError("DB_ERROR", "삭제에 실패했습니다.", 500);
  }
}
