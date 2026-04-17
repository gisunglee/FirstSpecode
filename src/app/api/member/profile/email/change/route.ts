/**
 * POST /api/member/profile/email/change — 이메일 변경 요청 (FID-00040)
 *
 * 역할:
 *   1. 새 이메일 중복 확인
 *   2. 현재 이메일과 동일 여부 확인
 *   3. 기존 EMAIL_CHANGE PENDING 건 → EXPIRED 처리
 *   4. 신규 인증 토큰 INSERT + 인증 메일 발송
 *
 * Body: { newEmail: string }
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { newEmail } = (body ?? {}) as Record<string, unknown>;

  if (!newEmail || typeof newEmail !== "string" || !newEmail.trim()) {
    return apiError("VALIDATION_ERROR", "이메일을 입력해 주세요.", 400);
  }

  try {
    const member = await prisma.tbCmMember.findUnique({
      where:  { mber_id: auth.mberId },
      select: { email_addr: true },
    });

    if (!member) {
      return apiError("NOT_FOUND", "회원 정보를 찾을 수 없습니다.", 404);
    }

    // 현재 이메일과 동일
    if (member.email_addr === newEmail) {
      return apiError("SAME_EMAIL", "현재 사용 중인 이메일과 동일합니다.", 400);
    }

    // 이메일 중복 확인
    const existing = await prisma.tbCmMember.findUnique({
      where: { email_addr: newEmail },
    });
    if (existing) {
      return apiError("DUPLICATE_EMAIL", "이미 사용 중인 이메일입니다.", 409);
    }

    const token  = generateVerifyToken();
    const expiry = new Date(Date.now() + VERIFY_EXPIRES_MS);

    await prisma.$transaction(async (tx) => {
      // 기존 EMAIL_CHANGE PENDING 건 만료 처리
      await tx.tbCmEmailVerification.updateMany({
        where: {
          mber_id:          auth.mberId,
          vrfctn_ty_code:   "EMAIL_CHANGE",
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

    // 새 이메일로 인증 메일 발송
    await sendEmailChangeEmail(newEmail, token);

    return apiSuccess({ newEmail });

  } catch (err) {
    console.error("[POST /api/member/profile/email/change] 오류:", err);
    return apiError("DB_ERROR", "이메일 변경 요청 중 오류가 발생했습니다.", 500);
  }
}
