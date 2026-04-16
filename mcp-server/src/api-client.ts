/**
 * api-client.ts — SPECODE API 호출 클라이언트
 *
 * 역할:
 *   - SPECODE Next.js API 서버에 HTTP 요청을 보냄
 *   - JWT 서비스 토큰을 자동 생성하여 Authorization 헤더에 포함
 *   - 에러 발생 시 명확한 메시지로 래핑
 *
 * 주의:
 *   - 서비스 토큰은 매 요청마다 발급 (1시간 유효 — 캐싱 불필요)
 *   - SPECODE API 응답 형식: { data: T } (성공), { code, message } (에러)
 */

import jwt from "jsonwebtoken";
import {
  getBaseUrl,
  getJwtSecret,
  getServiceMberId,
  getServiceEmail,
} from "./config.js";

// ─── JWT 서비스 토큰 발급 ─────────────────────────────────────────

/**
 * SPECODE API와 동일한 JWT 서명 방식으로 서비스 토큰 발급
 * — payload: { mberId, email }, 만료: 1시간
 * — SPECODE의 requireAuth()가 검증하는 것과 동일한 형식
 */
function createServiceToken(): string {
  return jwt.sign(
    { mberId: getServiceMberId(), email: getServiceEmail() },
    getJwtSecret(),
    { expiresIn: "1h" }
  );
}

// ─── API 호출 래퍼 ────────────────────────────────────────────────

/**
 * SPECODE API 호출 래퍼
 * — 서비스 토큰 자동 포함, 에러 시 명확한 메시지 throw
 *
 * @param path  API 경로 (예: "/api/projects")
 * @param init  fetch 옵션 (method, body 등)
 * @returns     응답의 data 필드 (apiSuccess 래핑 해제)
 */
export async function specodeFetch<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const token = createServiceToken();
  const url = `${getBaseUrl()}${path}`;

  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });

  // 응답 본문 파싱 — JSON이 아닐 수도 있으므로 방어
  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new Error(
      `SPECODE API 응답 파싱 실패 (${res.status} ${res.statusText}) — ${url}`
    );
  }

  // HTTP 에러 응답 처리 — SPECODE 에러 형식: { code, message }
  if (!res.ok) {
    const code = body.code ?? "UNKNOWN";
    const message = body.message ?? `HTTP ${res.status}`;
    throw new Error(`[${code}] ${message}`);
  }

  // 성공 응답 — SPECODE 형식: { data: T }
  return (body.data ?? body) as T;
}
