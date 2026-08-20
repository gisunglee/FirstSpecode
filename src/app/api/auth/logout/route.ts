/**
 * POST /api/auth/logout — 로그아웃 처리 (UW-00004)
 *
 * 역할:
 *   1. Refresh Token 폐기 (revoked_dt = NOW())
 *   2. 연결된 세션 무효화 (invald_dt = NOW())
 *
 * 특징:
 *   - 다중 기기 지원 — 요청에 포함된 RT에 해당하는 기기만 무효화
 *   - 이미 폐기된 RT도 200 반환 (멱등성 보장 — 중복 로그아웃 안전 처리)
 *
 * Body: {} — HttpOnly RT 쿠키 사용
 *       { refreshToken: string } — 구형 클라이언트 호환용
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { hashRefreshToken } from "@/lib/auth";
import {
  clearRefreshTokenCookie,
  isTrustedAuthRequest,
  readRequestRefreshCredential,
  requestUsesCookieAuthMode,
} from "@/lib/authRefreshCookie";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const { refreshToken: bodyRefreshToken } = (body ?? {}) as Record<string, unknown>;
  const cookieMode = requestUsesCookieAuthMode(request);
  const credential = readRequestRefreshCredential(request, bodyRefreshToken);

  if (!isTrustedAuthRequest(
    request,
    cookieMode || credential?.source === "cookie",
  )) {
    return apiError("CSRF_ERROR", "허용되지 않은 출처의 요청입니다.", 403);
  }

  if (!credential) {
    return clearRefreshTokenCookie(apiSuccess({ message: "로그아웃 되었습니다." }));
  }

  try {
    const tokenHash = hashRefreshToken(credential.token);

    // RT 조회 — 없으면 이미 폐기된 것으로 간주 (멱등 처리)
    const stored = await prisma.tbCmRefreshToken.findUnique({
      where: { token_hash_val: tokenHash },
    });

    if (!stored || stored.revoked_dt !== null) {
      // 이미 로그아웃된 상태 — 정상 처리로 응답 (클라이언트 재시도 안전)
      return clearRefreshTokenCookie(apiSuccess({ message: "로그아웃 되었습니다." }));
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      // RT 폐기
      await tx.tbCmRefreshToken.update({
        where: { token_id: stored.token_id },
        data:  { revoked_dt: now },
      });

      // 연결된 세션 무효화 — sesn_id가 있는 경우에만 처리
      if (stored.sesn_id) {
        await tx.tbCmMemberSession.update({
          where: { sesn_id: stored.sesn_id },
          data:  { invald_dt: now },
        });
      }
    });

    return clearRefreshTokenCookie(apiSuccess({ message: "로그아웃 되었습니다." }));

  } catch (err) {
    console.error("[POST /api/auth/logout] 오류:", err);
    // DB 폐기에 실패하면 쿠키를 유지해 사용자가 재시도할 수 있게 한다.
    // 먼저 쿠키를 지우면 서버에 남은 RT를 이후 요청에서 식별할 수 없다.
    return apiError("DB_ERROR", "로그아웃 처리 중 오류가 발생했습니다.", 500);
  }
}
