/**
 * GET /api/invitations/[token] — 초대 토큰 검증 및 정보 조회 (FID-00069)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ token: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { token } = await params;

  const invitation = await prisma.tbPjProjectInvitation.findUnique({
    where: { invt_token_val: token },
    include: {
      project: { select: { prjct_nm: true } },
    },
  });

  if (!invitation) {
    return apiError("INVALID_TOKEN", "유효하지 않은 초대 링크입니다.", 400);
  }

  // 만료 체크
  const isExpired = invitation.invt_sttus_code === "EXPIRED" ||
    (invitation.invt_sttus_code === "PENDING" && invitation.expiry_dt <= new Date());

  if (isExpired) {
    return apiError("TOKEN_EXPIRED", "초대 링크가 만료되었습니다. 초대 재발송을 요청해 주세요.", 400);
  }
  if (invitation.invt_sttus_code !== "PENDING") {
    return apiError("INVALID_TOKEN", "유효하지 않은 초대 링크입니다.", 400);
  }

  // 초대자 이메일 조회
  const inviter = invitation.invtr_mber_id
    ? await prisma.tbCmMember.findUnique({
        where: { mber_id: invitation.invtr_mber_id },
        select: { email_addr: true },
      })
    : null;

  return apiSuccess({
    projectId:    invitation.prjct_id,
    projectName:  invitation.project.prjct_nm,
    role:         invitation.role_code,
    inviterEmail: inviter?.email_addr ?? null,
    expiresAt:    invitation.expiry_dt,
  });
}
