/**
 * DELETE /api/projects/[id]/settings-history/[histId] — 이력 단건 삭제
 *
 * project.settings 권한(OWNER/ADMIN) 보유자만 삭제 가능.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; histId: string }> };

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, histId } = await params;

  const gate = await requirePermission(request, projectId, "project.settings");
  if (gate instanceof Response) return gate;

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
