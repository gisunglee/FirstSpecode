/**
 * requireAuth — API 라우트 인증 헬퍼
 *
 * 역할:
 *   - Authorization: Bearer <AT> 또는 Bearer <API키> 헤더 검증
 *   - JWT 토큰: 기존 방식 (verifyAccessToken으로 즉시 검증)
 *   - API 키 (spk_ prefix): DB에서 해시 조회 → 사용자 매핑
 *   - 유효하면 페이로드({ mberId, email }) 반환
 *   - 무효/누락이면 401 Response 반환
 *
 * 사용법:
 *   const auth = await requireAuth(request);
 *   if (auth instanceof Response) return auth;   ← 401 즉시 반환
 *   // auth.mberId, auth.email 사용 가능
 */

import { NextRequest } from "next/server";
import { verifyAccessToken, hashApiKey } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/apiResponse";

export type AuthPayload = { mberId: string; email: string };

/**
 * AT 또는 API 키 검증 — 성공 시 페이로드, 실패 시 401 Response 반환
 *
 * API 키 인증 흐름:
 *   1. "spk_" prefix 감지
 *   2. SHA-256 해시 → DB의 key_hash와 비교
 *   3. 폐기 여부(revoke_dt) 확인
 *   4. last_used_dt 비동기 갱신 (응답 차단 안 함)
 *   5. 연결된 회원의 mberId/email 반환
 */
export async function requireAuth(request: NextRequest): Promise<AuthPayload | Response> {
  const authHeader = request.headers.get("Authorization");

  // Authorization 헤더 누락 또는 형식 불일치
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return apiError("UNAUTHORIZED", "로그인이 필요합니다.", 401);
  }

  const token = authHeader.slice(7); // "Bearer " 이후 토큰 추출

  // ── API 키 인증 (spk_ prefix) ────────────────────────────────────
  if (token.startsWith("spk_")) {
    const keyHash = hashApiKey(token);

    const apiKey = await prisma.tbCmApiKey.findUnique({
      where: { key_hash: keyHash },
      include: { member: { select: { mber_id: true, email_addr: true } } },
    });

    // 키가 존재하지 않거나 폐기된 경우
    if (!apiKey || apiKey.revoke_dt) {
      return apiError("INVALID_API_KEY", "유효하지 않은 API 키입니다.", 401);
    }

    // last_used_dt 비동기 갱신 — 응답 지연 없이 fire-and-forget
    prisma.tbCmApiKey.update({
      where: { api_key_id: apiKey.api_key_id },
      data: { last_used_dt: new Date() },
    }).catch(() => {});

    return {
      mberId: apiKey.member.mber_id,
      email: apiKey.member.email_addr ?? "",
    };
  }

  // ── 기존 JWT 인증 ────────────────────────────────────────────────
  const payload = verifyAccessToken(token);

  // 토큰 만료 또는 서명 불일치
  if (!payload) {
    return apiError("TOKEN_EXPIRED", "인증이 만료되었습니다. 다시 로그인해 주세요.", 401);
  }

  return payload;
}
