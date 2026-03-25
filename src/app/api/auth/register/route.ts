/**
 * POST /api/auth/register — 이메일 회원가입 (FID-00005)
 *
 * 역할:
 *   1. tb_cm_member INSERT (mber_sttus_code = 'UNVERIFIED')
 *   2. tb_cm_email_verification INSERT (토큰, 만료 1시간)
 *   3. 인증 메일 발송
 *
 * Body: { email: string, password: string }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import {
  hashPassword,
  generateVerifyToken,
  verifyTokenExpiryDate,
  sendVerificationEmail,
} from "@/lib/auth";

// 비밀번호 복잡도: 영문+숫자+특수문자 포함 8자 이상
const PASSWORD_REGEX = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  if (!body || typeof body !== "object") {
    return apiError("VALIDATION_ERROR", "요청 본문이 올바르지 않습니다.", 400);
  }

  const { email, password } = body as Record<string, unknown>;

  // 입력값 검증
  if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email)) {
    return apiError("VALIDATION_ERROR", "올바른 이메일 형식을 입력해 주세요.", 400);
  }
  if (!password || typeof password !== "string" || !PASSWORD_REGEX.test(password)) {
    return apiError("VALIDATION_ERROR", "비밀번호는 영문·숫자·특수문자를 포함한 8자 이상이어야 합니다.", 400);
  }

  try {
    // 이메일 중복 확인 (동시 가입 경쟁 조건 방어)
    const existing = await prisma.tbCmMember.findUnique({
      where: { email_addr: email },
      select: { mber_id: true },
    });
    if (existing) {
      return apiError("DUPLICATE_EMAIL", "이미 가입된 이메일입니다. 로그인하거나 비밀번호를 재설정해 주세요.", 409);
    }

    const pswdHash = await hashPassword(password);
    const token    = generateVerifyToken();
    const expiry   = verifyTokenExpiryDate();

    // 회원 생성 + 인증 토큰 INSERT (트랜잭션)
    const member = await prisma.$transaction(async (tx) => {
      const newMember = await tx.tbCmMember.create({
        data: {
          email_addr:      email,
          pswd_hash:       pswdHash,
          mber_sttus_code: "UNVERIFIED",
        },
      });

      await tx.tbCmEmailVerification.create({
        data: {
          mber_id:          newMember.mber_id,
          email_addr:       email,
          vrfctn_token_val: token,
          vrfctn_ty_code:   "REGISTER",
          vrfctn_sttus_code:"PENDING",
          expiry_dt:        expiry,
        },
      });

      return newMember;
    });

    // 인증 메일 발송 (트랜잭션 외부 — 메일 실패가 DB 롤백을 유발하지 않도록)
    await sendVerificationEmail(email, token);

    return apiSuccess({ email: member.email_addr }, 201);
  } catch (err) {
    console.error("[POST /api/auth/register] 오류:", err);
    return apiError("DB_ERROR", "가입 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
}
