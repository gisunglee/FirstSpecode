/**
 * DELETE /api/projects/[id]/screens/[screenId]/description-history/[histId]
 *   — 화면 설명 이력 단건 삭제
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; screenId: string; histId: string }> };

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, screenId, histId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  try {
    // 이력이 이 화면·프로젝트에 속하는지 확인 후 삭제
    const result = await prisma.$executeRaw`
      DELETE FROM tb_ds_screen_desc_history
      WHERE hist_id  = ${histId}
        AND scrn_id  = ${screenId}
        AND prjct_id = ${projectId}
    `;

    if (result === 0) {
      return apiError("NOT_FOUND", "이력을 찾을 수 없습니다.", 404);
    }

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/.../description-history/${histId}] DB 오류:`, err);
    return apiError("DB_ERROR", "삭제 중 오류가 발생했습니다.", 500);
  }
}
