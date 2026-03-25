/**
 * DELETE /api/projects/[id]/invitations/[invitationId] — 초대 취소 (FID-00067)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; invitationId: string }> };

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, invitationId } = await params;

  // OWNER/ADMIN 확인
  const member = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!member || member.mber_sttus_code !== "ACTIVE" ||
      (member.role_code !== "OWNER" && member.role_code !== "ADMIN")) {
    return apiError("FORBIDDEN", "취소 권한이 없습니다.", 403);
  }

  const invitation = await prisma.tbPjProjectInvitation.findFirst({
    where: { invt_id: invitationId, prjct_id: projectId },
  });
  if (!invitation) return apiError("NOT_FOUND", "초대 내역을 찾을 수 없습니다.", 404);
  if (invitation.invt_sttus_code === "ACCEPTED") {
    return apiError("BAD_REQUEST", "이미 수락된 초대는 취소할 수 없습니다.", 400);
  }

  try {
    await prisma.tbPjProjectInvitation.update({
      where: { invt_id: invitationId },
      data: { invt_sttus_code: "CANCELLED", cancel_dt: new Date() },
    });
    return apiSuccess({ ok: true });
  } catch (err) {
    console.error(`[DELETE /invitations/${invitationId}] DB 오류:`, err);
    return apiError("DB_ERROR", "취소 중 오류가 발생했습니다.", 500);
  }
}
