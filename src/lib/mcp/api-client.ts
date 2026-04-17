/**
 * api-client.ts — MCP HTTP 엔드포인트용 API 클라이언트
 *
 * 역할:
 *   - 같은 Next.js 앱의 API route를 호출하는 래퍼
 *   - 인증: API 키(SPECODE_API_KEY) 우선, 없으면 JWT 서비스 토큰 fallback
 *   - Vercel 배포 시 자체 URL로 호출, 로컬에서는 localhost
 *
 * 환경변수:
 *   SPECODE_BASE_URL — 명시적 지정 시 사용 (기본: 자동 감지)
 *   VERCEL_URL       — Vercel이 자동 설정하는 배포 URL
 *   SPECODE_API_KEY  — API 키 (spk_... 형식, 프로필에서 발급)
 *   JWT_SECRET       — JWT 서명 키 (API 키 없을 때 fallback)
 *   SERVICE_MBER_ID  — 서비스 계정 회원 ID (API 키 없을 때 fallback)
 *   SERVICE_EMAIL    — 서비스 계정 이메일 (API 키 없을 때 fallback)
 */

import jwt from "jsonwebtoken";

// ─── Base URL 결정 ───────────────────────────────────────────────
// 우선순위: SPECODE_BASE_URL > VERCEL_URL > localhost
function getBaseUrl(): string {
  if (process.env.SPECODE_BASE_URL) return process.env.SPECODE_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

// ─── 인증 토큰 결정 ──────────────────────────────────────────────
function getAuthToken(): string {
  // API 키 우선
  const apiKey = process.env.SPECODE_API_KEY || "";
  if (apiKey) return apiKey;

  // fallback: JWT 서비스 토큰
  const secret = process.env.JWT_SECRET || "";
  const mberId = process.env.SERVICE_MBER_ID || "";
  const email = process.env.SERVICE_EMAIL || "";

  if (!secret || !mberId || !email) {
    throw new Error(
      "MCP 인증 실패: SPECODE_API_KEY 또는 (JWT_SECRET + SERVICE_MBER_ID + SERVICE_EMAIL)을 설정해 주세요"
    );
  }

  return jwt.sign({ mberId, email }, secret, { expiresIn: "1h" });
}

// ─── API 호출 래퍼 ────────────────────────────────────────────────
export async function specodeFetch<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const token = getAuthToken();
  const url = `${getBaseUrl()}${path}`;

  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });

  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new Error(
      `SPECODE API 응답 파싱 실패 (${res.status} ${res.statusText}) — ${url}`
    );
  }

  if (!res.ok) {
    const code = body.code ?? "UNKNOWN";
    const message = body.message ?? `HTTP ${res.status}`;
    throw new Error(`[${code}] ${message}`);
  }

  return (body.data ?? body) as T;
}
