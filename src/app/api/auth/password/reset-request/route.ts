/**
 * POST /api/auth/password/reset-request — 비밀번호 재설정 링크 발송 (FID-00026)
 *
 * 역할:
 *   1. 회원 조회 — 미가입이면 보안상 정상 응답 (계정 존재 여부 노출 차단)
 *   2. 소셜 전용 계정 (pswd_hash = NULL) → 안내 메시지
 *   3. 기존 PENDING 토큰 → EXPIRED 처리
 *   4. 새 토큰 INSERT + 재설정 메일 발송
 *
 * Body: { email: string }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { generateVerifyToken, sendPasswordResetEmail } from "@/lib/auth";

// 재설정 토큰 유효 시간 — 1시간
const RESET_TOKEN_EXPIRES_MS = 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { email } = (body ?? {}) as Record<string, unknown>;

  if (!email || typeof email !== "string" || !email.trim()) {
    return apiError("VALIDATION_ERROR", "이메일을 입력해 주세요.", 400);
  }

  try {
    const member = await prisma.tbCmMember.findUnique({
      where:  { email_addr: email },
      select: { mber_id: true, pswd_hash: true },
    });

    // 미가입 이메일 — 보안상 성공으로 응답 (가입 여부 노출 차단)
    if (!member) {
      return apiSuccess({ message: "재설정 링크를 발송했습니다." });
    }

    // 소셜 전용 계정 (pswd_hash = NULL) — 안내 메시지 반환
    if (!member.pswd_hash) {
      return apiSuccess({
        message: "소셜 계정으로 가입된 계정입니다. Google 또는 GitHub로 로그인해 주세요.",
        isSocialOnly: true,
      });
    }

    const token   = generateVerifyToken(); // 32바이트 랜덤 hex
    const expiry  = new Date(Date.now() + RESET_TOKEN_EXPIRES_MS);

    await prisma.$transaction(async (tx) => {
      // 기존 PENDING 토큰 → EXPIRED 처리 (하나의 활성 링크만 유지)
      await tx.tbCmPasswordResetToken.updateMany({
        where: { mber_id: member.mber_id, token_sttus_code: "PENDING" },
        data:  { token_sttus_code: "EXPIRED" },
      });

      // 신규 토큰 INSERT
      await tx.tbCmPasswordResetToken.create({
        data: {
          mber_id:          member.mber_id,
          token_val:        token,
          token_sttus_code: "PENDING",
          expiry_dt:        expiry,
        },
      });
    });

    // 메일 발송 (SMTP 미설정 시 콘솔 출력)
    await sendPasswordResetEmail(email, token);

    return apiSuccess({ message: "재설정 링크를 발송했습니다." });

  } catch (err) {
    console.error("[POST /api/auth/password/reset-request] 오류:", err);
    return apiError("DB_ERROR", "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
}
