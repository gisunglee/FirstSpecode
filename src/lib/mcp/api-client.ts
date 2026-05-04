/**
 * api-client.ts — MCP HTTP 엔드포인트용 API 클라이언트
 *
 * 역할:
 *   - 같은 Next.js 앱의 API route를 호출하는 래퍼
 *   - 두 가지 인증 모드 제공:
 *     (1) 토큰 전파(Token Propagation) — HTTP MCP용: 요청자 토큰을 그대로 릴레이
 *     (2) 서비스 토큰(env fallback) — 로컬/테스트용: SPECODE_MCP_KEY 또는 JWT
 *   - Vercel 배포 시 자체 URL로 호출, 로컬에서는 localhost
 *
 * 사용 원칙:
 *   - /api/mcp 같은 공용 엔드포인트에서는 반드시 createSpecodeFetch({ token })으로
 *     요청자 토큰을 주입할 것. env fallback을 쓰면 요청자와 다른 계정으로 조회되어
 *     다른 사용자의 프로젝트가 노출되는 치명적 권한 누수가 발생함.
 *
 * 환경변수:
 *   SPECODE_BASE_URL — 명시적 지정 시 사용 (기본: 자동 감지)
 *   VERCEL_URL       — Vercel이 자동 설정하는 배포 URL
 *   SPECODE_MCP_KEY  — MCP 인증 키 (spk_... 형식, 용도='MCP', 프로필에서 발급) — env fallback 전용
 *   JWT_SECRET       — JWT 서명 키 (MCP 키 없을 때 fallback)
 *   SERVICE_MBER_ID  — 서비스 계정 회원 ID (MCP 키 없을 때 fallback)
 *   SERVICE_EMAIL    — 서비스 계정 이메일 (MCP 키 없을 때 fallback)
 */

import jwt from "jsonwebtoken";

// ─── 타입 ──────────────────────────────────────────────────────────

/** specodeFetch 시그니처 — registerTools에 주입할 때 사용 */
export type SpecodeFetch = <T = unknown>(
  path: string,
  init?: RequestInit
) => Promise<T>;

/** createSpecodeFetch 옵션 */
export type CreateSpecodeFetchOptions = {
  /**
   * Authorization 헤더에 사용할 Bearer 토큰.
   * 지정하면 이 토큰을 그대로 내부 API로 전달(=토큰 전파).
   * 미지정 시 env 기반 fallback 사용(= stdio 로컬용).
   */
  token?: string;
};

// ─── Base URL 결정 ───────────────────────────────────────────────
// 우선순위: SPECODE_BASE_URL > VERCEL_URL > localhost
function getBaseUrl(): string {
  if (process.env.SPECODE_BASE_URL) return process.env.SPECODE_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

// ─── env 기반 fallback 토큰 ──────────────────────────────────────
// 주의: 이 경로는 요청자 컨텍스트가 아니라 "서비스 계정" 컨텍스트로 호출함.
//       HTTP MCP(/api/mcp)에서는 이 경로를 절대 타지 않도록 token을 주입할 것.
function getFallbackToken(): string {
  // MCP 키 우선
  const mcpKey = process.env.SPECODE_MCP_KEY || "";
  if (mcpKey) return mcpKey;

  // fallback의 fallback: JWT 서비스 토큰 자체 발급
  const secret = process.env.JWT_SECRET || "";
  const mberId = process.env.SERVICE_MBER_ID || "";
  const email  = process.env.SERVICE_EMAIL  || "";

  if (!secret || !mberId || !email) {
    throw new Error(
      "MCP 인증 실패: SPECODE_MCP_KEY 또는 (JWT_SECRET + SERVICE_MBER_ID + SERVICE_EMAIL)을 설정해 주세요"
    );
  }

  return jwt.sign({ mberId, email }, secret, { expiresIn: "1h" });
}

// ─── 팩토리: 주입된 토큰으로 specodeFetch 생성 ────────────────────
/**
 * specodeFetch 팩토리 — 요청 스코프 토큰을 주입해 fetch 함수를 생성
 *
 * 사용 예:
 *   // HTTP MCP — 요청자의 Authorization 헤더를 그대로 전파
 *   const authToken = request.headers.get("Authorization")!.slice(7);
 *   const fetchFn = createSpecodeFetch({ token: authToken });
 *   registerTools(server, fetchFn);
 *
 *   // 서버 간 호출(스크립트 등) — env fallback 사용
 *   const fetchFn = createSpecodeFetch();
 */
export function createSpecodeFetch(
  options: CreateSpecodeFetchOptions = {}
): SpecodeFetch {
  // 토큰은 생성 시점에 한 번 결정 — 요청마다 env를 재평가하지 않음
  const authToken = options.token ?? getFallbackToken();

  return async function specodeFetch<T = unknown>(
    path: string,
    init?: RequestInit
  ): Promise<T> {
    const url = `${getBaseUrl()}${path}`;

    const res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${authToken}`,
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
      const code    = body.code    ?? "UNKNOWN";
      const message = body.message ?? `HTTP ${res.status}`;
      throw new Error(`[${code}] ${message}`);
    }

    return (body.data ?? body) as T;
  };
}
