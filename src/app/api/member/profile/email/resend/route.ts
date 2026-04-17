/**
 * POST /api/member/profile/email/resend — 이메일 변경 인증 메일 재발송 (FID-00045)
 *
 * 역할:
 *   1. 기존 EMAIL_CHANGE PENDING 건 조회 (재발송할 대상 확인)
 *   2. 기존 PENDING → EXPIRED 처리
 *   3. 신규 토큰 INSERT + 인증 메일 재발송
 *
 * Header: Authorization: Bearer <AT>
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireAuth } from "@/lib/requireAuth";
import { generateVerifyToken, sendEmailChangeEmail } from "@/lib/auth";

const VERIFY_EXPIRES_MS = 60 * 60 * 1000; // 1시간

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    // 재발송할 PENDING 토큰 조회 (대상 이메일 확인용)
    const pending = await prisma.tbCmEmailVerification.findFirst({
      where: {
        mber_id:          auth.mberId,
        vrfctn_ty_code:   "EMAIL_CHANGE",
        vrfctn_sttus_code: "PENDING",
      },
      orderBy: { creat_dt: "desc" },
      select:  { email_addr: true },
    });

    if (!pending) {
      return apiError("NOT_FOUND", "진행 중인 이메일 변경 요청이 없습니다.", 404);
    }

    const newEmail = pending.email_addr;
    const token    = generateVerifyToken();
    const expiry   = new Date(Date.now() + VERIFY_EXPIRES_MS);

    await prisma.$transaction(async (tx) => {
      // 기존 PENDING 건 만료 처리
      await tx.tbCmEmailVerification.updateMany({
        where: {
          mber_id:           auth.mberId,
          vrfctn_ty_code:    "EMAIL_CHANGE",
          vrfctn_sttus_code: "PENDING",
        },
        data: { vrfctn_sttus_code: "EXPIRED" },
      });

      // 신규 토큰 INSERT
      await tx.tbCmEmailVerification.create({
        data: {
          mber_id:           auth.mberId,
          email_addr:        newEmail,
          vrfctn_token_val:  token,
          vrfctn_ty_code:    "EMAIL_CHANGE",
          vrfctn_sttus_code: "PENDING",
          expiry_dt:         expiry,
        },
      });
    });

    // 새 이메일로 인증 메일 재발송
    await sendEmailChangeEmail(newEmail, token);

    return apiSuccess({ newEmail });

  } catch (err) {
    console.error("[POST /api/member/profile/email/resend] 오류:", err);
    return apiError("DB_ERROR", "인증 메일 재발송 중 오류가 발생했습니다.", 500);
  }
}
