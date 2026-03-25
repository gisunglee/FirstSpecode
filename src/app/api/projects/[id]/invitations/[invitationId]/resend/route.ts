/**
 * POST /api/projects/[id]/invitations/[invitationId]/resend — 초대 재발송 (FID-00068)
 */

import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { sendInvitationEmail } from "@/lib/auth";

type RouteParams = { params: Promise<{ id: string; invitationId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, invitationId } = await params;

  // OWNER/ADMIN 확인
  const member = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!member || member.mber_sttus_code !== "ACTIVE" ||
      (member.role_code !== "OWNER" && member.role_code !== "ADMIN")) {
    return apiError("FORBIDDEN", "재발송 권한이 없습니다.", 403);
  }

  const invitation = await prisma.tbPjProjectInvitation.findFirst({
    where: { invt_id: invitationId, prjct_id: projectId },
  });
  if (!invitation) return apiError("NOT_FOUND", "초대 내역을 찾을 수 없습니다.", 404);
  if (invitation.invt_sttus_code === "ACCEPTED") {
    return apiError("BAD_REQUEST", "이미 수락된 초대입니다.", 400);
  }

  try {
    const newToken = randomBytes(32).toString("hex");
    const expiry   = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.tbPjProjectInvitation.update({
      where: { invt_id: invitationId },
      data: {
        invt_token_val:  newToken,
        invt_sttus_code: "PENDING",
        expiry_dt:       expiry,
      },
    });

    // 프로젝트명 + 초대자 이메일 조회 후 메일 재발송
    const [project, inviter] = await Promise.all([
      prisma.tbPjProject.findUnique({ where: { prjct_id: projectId }, select: { prjct_nm: true } }),
      prisma.tbCmMember.findUnique({ where: { mber_id: auth.mberId }, select: { email_addr: true } }),
    ]);

    await sendInvitationEmail(
      invitation.email_addr,
      newToken,
      project?.prjct_nm ?? "",
      inviter?.email_addr ?? auth.email
    ).catch((e) => console.error("[재발송 메일 오류]", e));

    return apiSuccess({ ok: true, expiresAt: expiry });
  } catch (err) {
    console.error(`[POST /invitations/${invitationId}/resend] DB 오류:`, err);
    return apiError("DB_ERROR", "재발송 중 오류가 발생했습니다.", 500);
  }
}
