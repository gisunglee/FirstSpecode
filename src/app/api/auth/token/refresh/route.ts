/**
 * POST /api/auth/token/refresh — 토큰 갱신 (FID-00014)
 *
 * 역할:
 *   1. IP별 Rate Limit (60회/분)
 *   2. 짧은 동시 재요청은 409, 그 이후 폐기 RT 재사용은 세션 전체 강제 종료
 *   3. 저장된 Refresh Token으로 새 AT/RT 발급
 *   4. 기존 RT 조건부 소비와 새 RT INSERT를 원자적으로 처리 (sesn_id 유지)
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
import {
  classifyRevokedRefreshTokenUse,
  RefreshSessionInvalidatedError,
  RefreshTokenRotationConflictError,
  rotateRefreshTokenAtomically,
} from "@/lib/refreshTokenRotation";

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

    // ── 재시도 경쟁과 도난 재사용 구분 ─────────────────────────────────
    // 이미 폐기된 RT가 또 들어오면 "회전 이후 도난된 구(舊) RT 재사용" 시나리오로 간주.
    // 해당 세션의 살아있는 모든 RT를 폐기하고 세션 자체를 invalidate → 공격자와 정상
    // 사용자 모두 재로그인을 강제해 도난 피해를 차단한다.
    if (stored.revoked_dt !== null) {
      const reuseKind = classifyRevokedRefreshTokenUse(stored.revoked_dt, new Date());
      if (reuseKind === "CONCURRENT_RETRY") {
        return apiError(
          "REFRESH_CONFLICT",
          "다른 탭에서 로그인 세션을 갱신하고 있습니다.",
          409
        );
      }

      if (stored.sesn_id) {
        const now = new Date();
        await prisma.$transaction(async (tx) => {
          await tx.tbCmRefreshToken.updateMany({
            where: { sesn_id: stored.sesn_id!, revoked_dt: null },
            data:  { revoked_dt: now },
          });
          await tx.tbCmMemberSession.updateMany({
            where: { sesn_id: stored.sesn_id!, invald_dt: null },
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

    if (!stored.sesn_id) {
      return apiError("INVALID_TOKEN", "유효하지 않은 Refresh Token입니다.", 401);
    }

    // Refresh는 빈도가 낮은 경계이므로 연결 세션의 무효화 여부를 직접 확인한다.
    const session = await prisma.tbCmMemberSession.findUnique({
      where: { sesn_id: stored.sesn_id },
      select: { mber_id: true, invald_dt: true },
    });
    if (
      !session ||
      session.mber_id !== stored.mber_id ||
      session.invald_dt !== null
    ) {
      return apiError("SESSION_INVALIDATED", "유효하지 않은 로그인 세션입니다.", 401);
    }

    const sessionId = stored.sesn_id;

    const newRawToken  = generateRefreshToken();
    const newTokenHash = hashRefreshToken(newRawToken);
    // auto_login_yn = 'Y'이면 만료일을 현재 기준 10일로 연장 (rolling session)
    const newExpiry    = refreshTokenExpiryDate();
    const now          = new Date();

    // 서명 실패로 DB 회전만 완료되는 상황을 피하려고 트랜잭션 전에 AT를 만든다.
    const accessToken = signAccessToken({
      mberId: stored.member.mber_id,
      email:  stored.member.email_addr ?? "",
      // 새 AT도 검증된 동일 세션에 묶는다.
      sesnId: sessionId,
    });

    try {
      await prisma.$transaction((tx) =>
        rotateRefreshTokenAtomically(tx, {
          tokenId:      stored.token_id,
          memberId:     stored.mber_id,
          sessionId,
          newTokenHash,
          autoLoginYn:  stored.auto_login_yn,
          newExpiry,
          now,
        })
      );
    } catch (err) {
      if (err instanceof RefreshTokenRotationConflictError) {
        return apiError(
          "REFRESH_CONFLICT",
          "다른 탭에서 로그인 세션을 갱신하고 있습니다.",
          409
        );
      }
      if (err instanceof RefreshSessionInvalidatedError) {
        return apiError(
          "SESSION_INVALIDATED",
          "유효하지 않은 로그인 세션입니다.",
          401
        );
      }
      throw err;
    }

    return apiSuccess({ accessToken, refreshToken: newRawToken });

  } catch (err) {
    console.error("[POST /api/auth/token/refresh] 오류:", err);
    return apiError("DB_ERROR", "토큰 갱신 중 오류가 발생했습니다.", 500);
  }
}
