/**
 * DELETE /api/projects/[id]/members/me — 일반 멤버 탈퇴 (FID-00086)
 *
 * 역할:
 *   - 본인 프로젝트 탈퇴 (mber_sttus_code = 'LEFT')
 *   - OWNER는 transfer-and-leave 또는 프로젝트 삭제 API를 사용해야 함
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  // 내 멤버십 확인
  const myMembership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!myMembership || myMembership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  // OWNER는 이 API로 탈퇴 불가 — 양도 후 탈퇴 또는 프로젝트 삭제 필요
  if (myMembership.role_code === "OWNER") {
    return apiError(
      "VALIDATION_ERROR",
      "OWNER는 OWNER를 양도한 후 탈퇴하거나 프로젝트를 삭제해야 합니다.",
      400
    );
  }

  try {
    await prisma.tbPjProjectMember.update({
      where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
      data: {
        mber_sttus_code: "LEFT",
        sttus_chg_dt:    new Date(),
      },
    });

    return apiSuccess({ ok: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/members/me] DB 오류:`, err);
    return apiError("DB_ERROR", "탈퇴 처리 중 오류가 발생했습니다.", 500);
  }
}
