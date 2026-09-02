/**
 * authFetch — 인증된 API 호출 래퍼
 *
 * 역할:
 *   - Authorization 헤더 자동 포함
 *   - 401 (TOKEN_EXPIRED) 응답 시 자동 토큰 갱신 및 재시도 (FID-00014)
 *   - 여러 API·브라우저 탭이 동시에 만료되어도 갱신 요청을 한 번으로 조정
 *   - RT 갱신 실패 / UNAUTHORIZED 응답 시 토큰 정리 후 로그인 페이지로 자동 이동
 *
 * 변형:
 *   - authFetch<T>(url, options): JSON 응답 자동 파싱 → T 반환 (대부분의 API용)
 *   - authFetchRaw(url, options): Response 그대로 반환 (Blob/파일 다운로드용)
 *     인증/갱신/리다이렉트 흐름은 authFetch 와 동일.
 */

import { toast } from "sonner";
import {
  clearAuthTokensAcrossTabs,
  ensureFreshAccessTokenResult,
  refreshAccessTokenResult,
} from "@/lib/authRefreshClient";
import type { AccessTokenRefreshResult } from "@/lib/authRefreshPolicy";
import { getStoredAccessToken } from "@/lib/authTokenStorage";

// ── 전역 상태 (메모리) ────────────────────────────────────────────────────────
// 동시 다발 401 → 로그인 페이지 이동을 한 번만 트리거하기 위한 플래그
let redirectTriggered = false;

/**
 * 세션 만료/인증 실패 시 토큰 정리 + 토스트 안내 + 로그인 페이지로 이동.
 *
 * - 동시에 여러 API가 401을 받아도 redirectTriggered 플래그로 1회만 실행
 * - /auth/* 경로에서는 스킵 (로그인 화면에서 401 → 무한 리다이렉트 방지)
 * - 토스트가 보일 시간 확보 후(0.8초) location.href 변경
 * - 현재 경로를 redirect 쿼리로 보존 → 로그인 성공 후 원위치 복귀
 */
function redirectToLogin(reason: "expired" | "unauthorized"): void {
  if (typeof window === "undefined") return;
  if (redirectTriggered) return;
  if (window.location.pathname.startsWith("/auth/")) return;

  redirectTriggered = true;

  // 토큰 정리 — 잔여 토큰으로 다음 요청이 또 401 받지 않도록
  clearAuthTokensAcrossTabs();

  // 사용자 안내 — 만료와 비로그인 케이스를 구분해 메시지 차별화
  toast.info(
    reason === "expired"
      ? "세션이 만료되었습니다. 다시 로그인해 주세요."
      : "로그인이 필요합니다."
  );

  // 로그인 후 원위치 복귀를 위해 현재 URL 보존 (?redirect=... 쿼리)
  const here = window.location.pathname + window.location.search;
  const redirect = encodeURIComponent(here);

  // 토스트가 잠깐 보이도록 약간 지연 후 이동
  setTimeout(() => {
    window.location.href = `/auth/login?redirect=${redirect}`;
  }, 800);
}

type AuthErrorBody = {
  code?: unknown;
  message?: unknown;
};

const RECOVERABLE_SESSION_CODES = new Set([
  "TOKEN_EXPIRED",
  "UNAUTHORIZED",
  "SESSION_INVALIDATED",
]);

function isRecoverableSessionError(body: AuthErrorBody): boolean {
  return typeof body.code === "string" && RECOVERABLE_SESSION_CODES.has(body.code);
}

async function readAuthError(response: Response): Promise<AuthErrorBody> {
  return response.clone().json().catch(() => ({})) as Promise<AuthErrorBody>;
}

function requestHeaders(
  options: RequestInit | undefined,
  accessToken: string | null,
  jsonDefault: boolean,
): Headers {
  const headers = new Headers(options?.headers);
  if (jsonDefault && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  else headers.delete("Authorization");
  return headers;
}

/**
 * 인증 요청의 단일 실행 경로.
 *
 * 1) 만료 2분 전 또는 AT 부재 시 RT 쿠키로 선제 복원
 * 2) 서버 401은 다른 탭의 최신 AT 또는 RT 회전으로 한 번만 복구
 * 3) 최종 실패일 때만 전체 탭을 정리하고 로그인 화면으로 이동
 */
async function authenticatedRequest(
  url: string,
  options: RequestInit | undefined,
  jsonDefault: boolean,
): Promise<Response> {
  const initialRefresh = await ensureFreshAccessTokenResult();
  let accessToken = initialRefresh.status === "success"
    ? initialRefresh.accessToken
    : getStoredAccessToken() || null;
  let response = await fetch(url, {
    ...options,
    headers: requestHeaders(options, accessToken, jsonDefault),
  });

  if (response.status !== 401) return response;

  let errorBody = await readAuthError(response);
  if (!isRecoverableSessionError(errorBody)) return response;

  // 다른 요청/탭이 이미 갱신했다면 불필요한 RT 회전 없이 최신 AT로 먼저 재시도한다.
  const storedToken = getStoredAccessToken();
  const recovery: AccessTokenRefreshResult = storedToken && storedToken !== accessToken
    ? { status: "success", accessToken: storedToken }
    : await refreshAccessTokenResult();

  if (recovery.status === "success") {
    accessToken = recovery.accessToken;
    response = await fetch(url, {
      ...options,
      headers: requestHeaders(options, accessToken, jsonDefault),
    });
    if (response.status !== 401) return response;

    errorBody = await readAuthError(response);
    if (!isRecoverableSessionError(errorBody)) return response;
  }

  // 네트워크·충돌·서버 일시 오류는 세션 종료가 아니다. 로그인 화면으로 보내거나
  // 다른 탭의 인증 정보를 지우지 않고, 현재 화면에서 다음 요청의 재시도를 허용한다.
  if (recovery.status === "transient") {
    throw new Error("로그인 상태를 확인하는 중 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
  }

  const reason = errorBody.code === "UNAUTHORIZED" ? "unauthorized" : "expired";
  redirectToLogin(reason);
  const message = typeof errorBody.message === "string"
    ? errorBody.message
    : reason === "expired"
      ? "세션이 만료되었습니다. 다시 로그인해 주세요."
      : "로그인이 필요합니다.";
  throw new Error(message);
}

export async function authFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await authenticatedRequest(url, options, true);
  if (!response.ok) {
    let message = `요청 실패 (${response.status})`;
    try {
      const errorBody = await response.json();
      if (typeof errorBody?.message === "string") message = errorBody.message;
    } catch {
      // JSON 오류 본문이 아니면 상태 코드 기반 기본 메시지를 사용한다.
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

/**
 * authFetchRaw — Blob/파일 다운로드용 인증 호출
 *
 * authFetch 와 같은 인증 흐름(토큰 갱신, 401 처리, 로그인 리다이렉트)을 따르되,
 * 응답을 JSON 으로 파싱하지 않고 Response 객체를 그대로 반환한다.
 * 호출자가 res.blob() / res.arrayBuffer() / res.json() 중 적절한 것을 선택할 수 있다.
 *
 * 사용 예 (엑셀 다운로드):
 *   const res = await authFetchRaw(`/api/projects/${id}/tasks/export`);
 *   if (!res.ok) { ... }
 *   const blob = await res.blob();
 */
export async function authFetchRaw(url: string, options?: RequestInit): Promise<Response> {
  return authenticatedRequest(url, options, false);
}
