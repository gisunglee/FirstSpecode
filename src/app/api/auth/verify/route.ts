/**
 * POST /api/auth/verify — 이메일 인증 토큰 검증 (FID-00012)
 *
 * 역할:
 *   1. vrfctn_token_val 조회 및 유효성 확인
 *   2. PENDING + 미만료 시 → VERIFIED 처리, 회원 ACTIVE 전환
 *   3. JWT 액세스 토큰 + 리프레시 토큰 발급
 *
 * Body: { token: string }
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

  const { token } = (body ?? {}) as Record<string, unknown>;

  if (!token || typeof token !== "string") {
    return apiError("VALIDATION_ERROR", "인증 토큰이 필요합니다.", 400);
  }

  try {
    // 토큰 조회
    const verification = await prisma.tbCmEmailVerification.findUnique({
      where: { vrfctn_token_val: token },
      include: { member: { select: { mber_id: true, email_addr: true } } },
    });

    if (!verification) {
      return apiError("INVALID_TOKEN", "유효하지 않은 인증 링크입니다.", 400);
    }

    // 만료 확인
    if (new Date() > verification.expiry_dt) {
      return apiError("TOKEN_EXPIRED", "인증 링크가 만료되었습니다.", 400);
    }

    // 이미 사용된 토큰
    if (verification.vrfctn_sttus_code !== "PENDING") {
      return apiError("INVALID_TOKEN", "유효하지 않은 인증 링크입니다.", 400);
    }

    const { mber_id, email_addr } = verification.member;
    const refreshTokenRaw  = generateRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshTokenRaw);
    const refreshExpiry    = refreshTokenExpiryDate();

    // 세션 기록용 기기 정보
    const ipAddr    = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
                   ?? request.headers.get("x-real-ip")
                   ?? "unknown";
    const userAgent = request.headers.get("user-agent") ?? "unknown";

    // 트랜잭션: 검증 완료 + 회원 활성화 + 세션·RT 발급
    // 과거엔 세션 없이 RT만 만들어 기기별 로그아웃이 작동하지 않는 버그가 있었음.
    // 다른 로그인 경로와 동일하게 세션을 먼저 만들고 sesn_id로 연결한다.
    const sesnId = await prisma.$transaction(async (tx) => {
      await tx.tbCmEmailVerification.update({
        where: { vrfctn_id: verification.vrfctn_id },
        data: {
          vrfctn_sttus_code: "VERIFIED",
          vrfctn_dt:         new Date(),
        },
      });

      await tx.tbCmMember.update({
        where: { mber_id },
        data: { mber_sttus_code: "ACTIVE" },
      });

      const sesn = await tx.tbCmMemberSession.create({
        data: { mber_id, device_info_cn: userAgent, ip_addr: ipAddr },
      });

      await tx.tbCmRefreshToken.create({
        data: {
          mber_id,
          token_hash_val: refreshTokenHash,
          expiry_dt:      refreshExpiry,
          sesn_id:        sesn.sesn_id,
        },
      });

      return sesn.sesn_id;
    });

    const accessToken = signAccessToken({ mberId: mber_id, email: email_addr!, sesnId });

    return apiSuccess({ accessToken, refreshToken: refreshTokenRaw });
  } catch (err) {
    console.error("[POST /api/auth/verify] 오류:", err);
    return apiError("DB_ERROR", "인증 처리 중 오류가 발생했습니다.", 500);
  }
}
