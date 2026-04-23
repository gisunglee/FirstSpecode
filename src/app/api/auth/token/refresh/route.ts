/**
 * POST /api/auth/token/refresh — 토큰 갱신 (FID-00014)
 *
 * 역할:
 *   1. IP별 Rate Limit (60회/분)
 *   2. 이미 폐기된 RT의 재사용이면 → 도난 간주, 세션 전체 강제 종료
 *   3. 저장된 Refresh Token으로 새 AT/RT 발급
 *   4. 기존 RT revoke, 새 RT INSERT (sesn_id 유지)
 *   5. auto_login_yn = 'Y'이면 만료일 10일 연장
 *
 * Body: { refreshToken: string }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiryDate,
} from "@/lib/auth";

// 토큰 갱신 폭주 방어 — 정상 사용자는 30분마다 1회 수준이므로 60회/분은 충분히 여유
const REFRESH_IP_LIMIT      = 60;
const REFRESH_IP_WINDOW_SEC = 60;

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

  // IP별 Rate Limit — 봇/브루트포스 방어
  const ipAddr = getClientIp(request);
  const rl = await checkRateLimit({
    key:       `REFRESH_IP:${ipAddr}`,
    limit:     REFRESH_IP_LIMIT,
    windowSec: REFRESH_IP_WINDOW_SEC,
  });
  if (!rl.ok) {
    return apiError(
      "RATE_LIMITED",
      "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
      429,
      { retryAfter: rl.retryAfter },
      { "Retry-After": String(rl.retryAfter) }
    );
  }

  try {
    const tokenHash = hashRefreshToken(refreshToken);

    // 토큰 조회 — revoked/expired 여부와 무관하게 일단 찾는다(도난 탐지 때문).
    const stored = await prisma.tbCmRefreshToken.findUnique({
      where: { token_hash_val: tokenHash },
      include: {
        member: { select: { mber_id: true, email_addr: true, mber_sttus_code: true } },
      },
    });

    if (!stored) {
      return apiError("INVALID_TOKEN", "유효하지 않은 Refresh Token입니다.", 401);
    }

    // ── 도난 탐지(RFC 6749 모범) ────────────────────────────────────
    // 이미 폐기된 RT가 또 들어오면 "회전 이후 도난된 구(舊) RT 재사용" 시나리오로 간주.
    // 해당 세션의 살아있는 모든 RT를 폐기하고 세션 자체를 invalidate → 공격자와 정상
    // 사용자 모두 재로그인을 강제해 도난 피해를 차단한다.
    if (stored.revoked_dt !== null) {
      if (stored.sesn_id) {
        const now = new Date();
        await prisma.$transaction(async (tx) => {
          await tx.tbCmRefreshToken.updateMany({
            where: { sesn_id: stored.sesn_id!, revoked_dt: null },
            data:  { revoked_dt: now },
          });
          await tx.tbCmMemberSession.update({
            where: { sesn_id: stored.sesn_id! },
            data:  { invald_dt: now },
          });
        });
      }
      console.warn(
        `[REFRESH_REUSE] Revoked RT reused — mber_id=${stored.mber_id}, sesn_id=${stored.sesn_id ?? "null"}, ip=${ipAddr}`
      );
      return apiError(
        "TOKEN_REUSE_DETECTED",
        "보안 이유로 세션이 종료되었습니다. 다시 로그인해 주세요.",
        401
      );
    }

    if (stored.expiry_dt < new Date()) {
      return apiError("INVALID_TOKEN", "유효하지 않은 Refresh Token입니다.", 401);
    }

    // 비활성 계정 차단
    if (stored.member.mber_sttus_code !== "ACTIVE") {
      return apiError("UNAUTHORIZED", "접근 권한이 없습니다.", 401);
    }

    const newRawToken  = generateRefreshToken();
    const newTokenHash = hashRefreshToken(newRawToken);
    // auto_login_yn = 'Y'이면 만료일을 현재 기준 10일로 연장 (rolling session)
    const newExpiry    = refreshTokenExpiryDate();
    const now          = new Date();

    await prisma.$transaction(async (tx) => {
      // 기존 토큰 폐기
      await tx.tbCmRefreshToken.update({
        where: { token_id: stored.token_id },
        data:  { revoked_dt: now },
      });

      // 새 토큰 발급 — 기존 sesn_id를 반드시 이어받아야
      // logout 시 세션 무효화가 작동하고, AT 페이로드의 sesnId와도 일치한다.
      await tx.tbCmRefreshToken.create({
        data: {
          mber_id:       stored.mber_id,
          token_hash_val: newTokenHash,
          auto_login_yn:  stored.auto_login_yn,
          expiry_dt:      newExpiry,
          sesn_id:        stored.sesn_id,
        },
      });

      // 세션 마지막 접속 시각 갱신 — 접속 추적 및 장기 미사용 세션 정리용
      if (stored.sesn_id) {
        await tx.tbCmMemberSession.update({
          where: { sesn_id: stored.sesn_id },
          data:  { last_acces_dt: now },
        });
      }
    });

    const accessToken = signAccessToken({
      mberId: stored.member.mber_id,
      email:  stored.member.email_addr ?? "",
      // 새 AT도 동일 세션에 묶이도록 sesnId 유지 (없으면 undefined)
      sesnId: stored.sesn_id ?? undefined,
    });

    return apiSuccess({ accessToken, refreshToken: newRawToken });

  } catch (err) {
    console.error("[POST /api/auth/token/refresh] 오류:", err);
    return apiError("DB_ERROR", "토큰 갱신 중 오류가 발생했습니다.", 500);
  }
}
