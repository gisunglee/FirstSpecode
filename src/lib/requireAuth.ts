/**
 * requireAuth — API 라우트 인증 헬퍼
 *
 * 역할:
 *   - Authorization: Bearer <AT> 헤더 검증
 *   - 유효하면 페이로드({ mberId, email }) 반환
 *   - 무효/누락이면 401 Response 반환
 *
 * 사용법:
 *   const auth = requireAuth(request);
 *   if (auth instanceof Response) return auth;   ← 401 즉시 반환
 *   // auth.mberId, auth.email 사용 가능
 */

import { NextRequest } from "next/server";
import { verifyAccessToken } from "@/lib/auth";
import { apiError } from "@/lib/apiResponse";

export type AuthPayload = { mberId: string; email: string };

/**
 * AT 검증 — 성공 시 페이로드, 실패 시 401 Response 반환
 */
export function requireAuth(request: NextRequest): AuthPayload | Response {
  const authHeader = request.headers.get("Authorization");

  // Authorization 헤더 누락 또는 형식 불일치
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return apiError("UNAUTHORIZED", "로그인이 필요합니다.", 401);
  }

  const token   = authHeader.slice(7); // "Bearer " 이후 토큰 추출
  const payload = verifyAccessToken(token);

  // 토큰 만료 또는 서명 불일치
  if (!payload) {
    return apiError("TOKEN_EXPIRED", "인증이 만료되었습니다. 다시 로그인해 주세요.", 401);
  }

  return payload;
}
