/**
 * DELETE /api/projects/[id]/requirements/[reqId]/history/[historyId] — 이력 삭제 (FID-00119)
 *
 * - INTERNAL 버전만 삭제 가능
 * - CONFIRMED 버전 삭제 시도 시 400 반환
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; reqId: string; historyId: string }> };

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, reqId, historyId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  try {
    const history = await prisma.tbRqRequirementHistory.findUnique({
      where:  { req_hist_id: historyId },
      select: { req_id: true, vrsn_ty_code: true },
    });

    if (!history || history.req_id !== reqId) {
      return apiError("NOT_FOUND", "이력을 찾을 수 없습니다.", 404);
    }

    // 확정 버전은 삭제 불가 (비즈니스 규칙)
    if (history.vrsn_ty_code === "CONFIRMED") {
      return apiError("VALIDATION_ERROR", "확정 버전은 삭제할 수 없습니다.", 400);
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
