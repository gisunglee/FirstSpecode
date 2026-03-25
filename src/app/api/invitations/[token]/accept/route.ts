/**
 * POST /api/invitations/[token]/accept — 초대 수락 처리 (FID-00070)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ token: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { token } = await params;

  const invitation = await prisma.tbPjProjectInvitation.findUnique({
    where: { invt_token_val: token },
  });

  if (!invitation) {
    return apiError("INVALID_TOKEN", "유효하지 않은 초대 링크입니다.", 400);
  }
  if (invitation.invt_sttus_code !== "PENDING" || invitation.expiry_dt <= new Date()) {
    return apiError("TOKEN_EXPIRED", "초대 링크가 만료되었습니다.", 400);
  }

  // 이미 멤버인지 확인
  const existing = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: invitation.prjct_id, mber_id: auth.mberId } },
  });
  if (existing && existing.mber_sttus_code === "ACTIVE") {
    return apiError("ALREADY_MEMBER", "이미 해당 프로젝트의 멤버입니다.", 409);
  }

  try {
    await prisma.$transaction(async (tx) => {
      // 초대 상태 → ACCEPTED
      await tx.tbPjProjectInvitation.update({
        where: { invt_token_val: token },
        data: { invt_sttus_code: "ACCEPTED", accept_dt: new Date() },
      });

      // 멤버 등록 (이미 있으면 upsert)
      await tx.tbPjProjectMember.upsert({
        where: { prjct_id_mber_id: { prjct_id: invitation.prjct_id, mber_id: auth.mberId } },
        create: {
          prjct_id:        invitation.prjct_id,
          mber_id:         auth.mberId,
          role_code:       invitation.role_code,
          mber_sttus_code: "ACTIVE",
        },
        update: {
          role_code:       invitation.role_code,
          mber_sttus_code: "ACTIVE",
        },
      });
    });

    return apiSuccess({ projectId: invitation.prjct_id });
  } catch (err) {
    console.error(`[POST /invitations/${token}/accept] DB 오류:`, err);
    return apiError("DB_ERROR", "수락 처리 중 오류가 발생했습니다.", 500);
  }
}
