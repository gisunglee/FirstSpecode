/**
 * POST /api/auth/email/resend — 인증 메일 재발송 (FID-00010)
 *
 * 역할:
 *   1. 기존 PENDING 인증 토큰 → EXPIRED 처리
 *   2. 새 토큰 INSERT + 인증 메일 재발송
 *
 * Body: { email: string }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import {
  generateVerifyToken,
  verifyTokenExpiryDate,
  sendVerificationEmail,
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { email } = (body ?? {}) as Record<string, unknown>;

  if (!email || typeof email !== "string") {
    return apiError("VALIDATION_ERROR", "이메일을 입력해 주세요.", 400);
  }

  try {
    // 회원 조회 — 존재하지 않으면 404
    const member = await prisma.tbCmMember.findUnique({
      where: { email_addr: email },
      select: { mber_id: true, mber_sttus_code: true },
    });

    if (!member) {
      return apiError("NOT_FOUND", "등록되지 않은 이메일입니다.", 404);
    }

    // 이미 인증 완료된 계정에는 재발송 불필요
    if (member.mber_sttus_code === "ACTIVE") {
      return apiError("ALREADY_VERIFIED", "이미 인증이 완료된 계정입니다.", 409);
    }

    const token  = generateVerifyToken();
    const expiry = verifyTokenExpiryDate();

    await prisma.$transaction(async (tx) => {
      // 기존 PENDING 토큰 모두 EXPIRED 처리
      await tx.tbCmEmailVerification.updateMany({
        where: {
          mber_id:          member.mber_id,
          vrfctn_ty_code:   "REGISTER",
          vrfctn_sttus_code:"PENDING",
        },
        data: { vrfctn_sttus_code: "EXPIRED" },
      });

      // 새 토큰 생성
      await tx.tbCmEmailVerification.create({
        data: {
          mber_id:          member.mber_id,
          email_addr:       email,
          vrfctn_token_val: token,
          vrfctn_ty_code:   "REGISTER",
          vrfctn_sttus_code:"PENDING",
          expiry_dt:        expiry,
        },
      });
    });

    await sendVerificationEmail(email, token);

    return apiSuccess({ message: "인증 메일을 재발송했습니다." });
  } catch (err) {
    console.error("[POST /api/auth/email/resend] 오류:", err);
    return apiError("DB_ERROR", "재발송 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
}
