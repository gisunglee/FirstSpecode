/**
 * POST /api/auth/social/link — 소셜 계정 연동 처리 (FID-00024)
 *
 * 역할:
 *   1. socialToken 검증 → Provider 정보 추출
 *   2. 기존 회원에 소셜 계정 INSERT
 *   3. AT/RT 발급
 *
 * Body: { socialToken: string, email: string }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import {
  verifySocialToken,
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiryDate,
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { socialToken, email } = (body ?? {}) as Record<string, unknown>;

  if (!socialToken || typeof socialToken !== "string") {
    return apiError("VALIDATION_ERROR", "소셜 토큰이 필요합니다.", 400);
  }
  if (!email || typeof email !== "string") {
    return apiError("VALIDATION_ERROR", "이메일이 필요합니다.", 400);
  }

  // socialToken 검증
  const payload = verifySocialToken(socialToken);
  if (!payload) {
    return apiError("INVALID_TOKEN", "인증이 만료되었습니다. 소셜 로그인을 다시 시도해 주세요.", 400);
  }

  // token에 포함된 이메일과 요청 이메일 일치 확인
  if (payload.email !== email) {
    return apiError("VALIDATION_ERROR", "이메일 정보가 일치하지 않습니다.", 400);
  }

  const ipAddr    = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const userAgent = request.headers.get("user-agent") ?? "unknown";

  try {
    // 기존 회원 조회
    const member = await prisma.tbCmMember.findUnique({
      where:  { email_addr: email },
      select: { mber_id: true },
    });

    if (!member) {
      return apiError("NOT_FOUND", "회원 정보를 찾을 수 없습니다.", 404);
    }

    // 이미 연동된 소셜 계정 확인
    const existing = await prisma.tbCmSocialAccount.findUnique({
      where: {
        provdr_code_provdr_user_id: {
          provdr_code:    payload.provdrCode,
          provdr_user_id: payload.provdrUserId,
        },
      },
    });

    if (existing) {
      return apiError("ALREADY_LINKED", "이미 연동된 소셜 계정입니다.", 409);
    }

    const rt      = generateRefreshToken();
    const rtHash  = hashRefreshToken(rt);
    const rtExpiry = refreshTokenExpiryDate();

    const sesnId = await prisma.$transaction(async (tx) => {
      // 소셜 계정 연동
      await tx.tbCmSocialAccount.create({
        data: {
          mber_id:           member.mber_id,
          provdr_code:       payload.provdrCode,
          provdr_user_id:    payload.provdrUserId,
          provdr_email_addr: payload.email,
        },
      });

      // 세션 먼저 생성 후 RT와 연결 (기기별 로그아웃 지원)
      const sesn = await tx.tbCmMemberSession.create({
        data: { mber_id: member.mber_id, device_info_cn: userAgent, ip_addr: ipAddr },
      });

      // 리프레시 토큰 발급 + 세션 연결
      await tx.tbCmRefreshToken.create({
        data: { mber_id: member.mber_id, token_hash_val: rtHash, expiry_dt: rtExpiry, sesn_id: sesn.sesn_id },
      });

      return sesn.sesn_id;
    });

    const accessToken = signAccessToken({ mberId: member.mber_id, email, sesnId });

    return apiSuccess({ accessToken, refreshToken: rt });

  } catch (err) {
    console.error("[POST /api/auth/social/link] 오류:", err);
    return apiError("DB_ERROR", "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
}
