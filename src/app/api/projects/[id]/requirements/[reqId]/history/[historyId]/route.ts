/**
 * DELETE /api/projects/[id]/requirements/[reqId]/history/[historyId] — 이력 삭제 (FID-00119)
 *
 * - INTERNAL 버전만 삭제 가능
 * - CONFIRMED 버전 삭제 시도 시 400 반환
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; reqId: string; historyId: string }> };

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, reqId, historyId } = await params;

  // 권한 가드 — 역할 매트릭스(permissions.ts) 기반.
  // 결제 잠금(§1-6)·지원 세션 읽기전용·프로젝트 삭제 상태도 requirePermission 이 함께 처리한다.
  const auth = await requirePermission(request, projectId, "content.delete");
  if (auth instanceof Response) return auth;

  try {
    const history = await prisma.tbRqRequirementHistory.findUnique({
      where:  { req_hist_id: historyId },
      select: { req_id: true },
    });

    if (!history || history.req_id !== reqId) {
      return apiError("NOT_FOUND", "이력을 찾을 수 없습니다.", 404);
    }

    await prisma.tbRqRequirementHistory.delete({ where: { req_hist_id: historyId } });

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(
      `[DELETE /api/projects/${projectId}/requirements/${reqId}/history/${historyId}] DB 오류:`,
      err
    );
    return apiError("DB_ERROR", "이력 삭제 중 오류가 발생했습니다.", 500);
  }
}
