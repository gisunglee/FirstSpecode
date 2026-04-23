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
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { generateVerifyToken, sendPasswordResetEmail } from "@/lib/auth";

// 재설정 토큰 유효 시간 — 1시간
const RESET_TOKEN_EXPIRES_MS = 60 * 60 * 1000;

// 비밀번호 재설정 메일 폭탄 방어 — 이메일별 + IP별 이중 제한
//   이메일별: 동일 계정으로 보내는 메일 폭주를 제한
//   IP별:    대량 이메일 투입(dictionary attack) 제한
const RESET_EMAIL_LIMIT       = 3;
const RESET_EMAIL_WINDOW_SEC  = 3600;
const RESET_IP_LIMIT          = 10;
const RESET_IP_WINDOW_SEC     = 3600;

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

  // IP + 이메일 이중 Rate Limit
  //   - 이메일별 3회/시간: 같은 계정으로 반복 발송 차단
  //   - IP별 10회/시간:   다양한 이메일을 투입하는 공격 차단
  //   둘 중 하나라도 초과하면 429. 순서는 상관없으므로 병렬 체크.
  const ipAddr = getClientIp(request);
  const [ipRl, emailRl] = await Promise.all([
    checkRateLimit({ key: `RESET_IP:${ipAddr}`,     limit: RESET_IP_LIMIT,    windowSec: RESET_IP_WINDOW_SEC    }),
    checkRateLimit({ key: `RESET_EMAIL:${email}`,   limit: RESET_EMAIL_LIMIT, windowSec: RESET_EMAIL_WINDOW_SEC }),
  ]);
  if (!ipRl.ok || !emailRl.ok) {
    const retryAfter = Math.max(
      ipRl.ok    ? 0 : ipRl.retryAfter,
      emailRl.ok ? 0 : emailRl.retryAfter,
    );
    return apiError(
      "RATE_LIMITED",
      "재설정 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
      429,
      { retryAfter },
      { "Retry-After": String(retryAfter) }
    );
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
