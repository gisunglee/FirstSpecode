/**
 * POST /api/auth/token/refresh — 토큰 갱신 (FID-00014)
 *
 * 역할:
 *   1. 저장된 Refresh Token으로 새 AT/RT 발급
 *   2. 기존 RT revoke, 새 RT INSERT
 *   3. auto_login_yn = 'Y'이면 만료일 10일 연장
 *
 * Body: { refreshToken: string }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import {
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

  const { refreshToken } = (body ?? {}) as Record<string, unknown>;

  if (!refreshToken || typeof refreshToken !== "string") {
    return apiError("VALIDATION_ERROR", "Refresh Token이 필요합니다.", 400);
  }

  try {
    const tokenHash = hashRefreshToken(refreshToken);

    // 유효한 토큰 조회 (미폐기 + 미만료)
    const stored = await prisma.tbCmRefreshToken.findUnique({
      where: { token_hash_val: tokenHash },
      include: {
        member: { select: { mber_id: true, email_addr: true, mber_sttus_code: true } },
      },
    });

    if (
      !stored ||
      stored.revoked_dt !== null ||
      stored.expiry_dt < new Date()
    ) {
      return apiError("INVALID_TOKEN", "유효하지 않은 Refresh Token입니다.", 401);
    }

    // 비활성 계정 차단
    if (stored.member.mber_sttus_code !== "ACTIVE") {
      return apiError("UNAUTHORIZED", "접근 권한이 없습니다.", 401);
    }

    const newRawToken  = generateRefreshToken();
    const newTokenHash = hashRefreshToken(newRawToken);
    // auto_login_yn = 'Y'이면 만료일을 현재 기준 10일로 연장
    const newExpiry    = refreshTokenExpiryDate();

    await prisma.$transaction(async (tx) => {
      // 기존 토큰 폐기
      await tx.tbCmRefreshToken.update({
        where: { token_id: stored.token_id },
        data:  { revoked_dt: new Date() },
      });

      // 새 토큰 발급
      await tx.tbCmRefreshToken.create({
        data: {
          mber_id:       stored.mber_id,
          token_hash_val: newTokenHash,
          auto_login_yn:  stored.auto_login_yn,
          expiry_dt:      newExpiry,
        },
      });
    });

    const accessToken = signAccessToken({
      mberId: stored.member.mber_id,
      email:  stored.member.email_addr ?? "",
    });

    return apiSuccess({ accessToken, refreshToken: newRawToken });

  } catch (err) {
    console.error("[POST /api/auth/token/refresh] 오류:", err);
    return apiError("DB_ERROR", "토큰 갱신 중 오류가 발생했습니다.", 500);
  }
}
