/**
 * authFetch — 인증된 API 호출 래퍼
 *
 * 역할:
 *   - Authorization 헤더 자동 포함
 *   - 401 (TOKEN_EXPIRED) 응답 시 자동 토큰 갱신 및 재시도 (FID-00014)
 *   - 여러 API·브라우저 탭이 동시에 만료되어도 갱신 요청을 한 번으로 조정
 *   - RT 갱신 최종 실패 / UNAUTHORIZED 응답 시 토큰 정리 후 **세션 만료 모달** 표시
 *     → 화면을 떠나지 않으므로 작성 중인 내용(폼·에디터)이 보존된다.
 *       모달을 띄울 곳(MainLayout)이 없는 화면에서만 로그인 페이지로 이동(폴백).
 *
 * 401 복구 사다리 (위에서부터, 성공하면 즉시 반환):
 *   1) 저장소에 "다른 탭이 갱신해 둔" 더 새로운 AT 가 있으면 그것으로 재시도 (네트워크 없음)
 *   2) 서버에 실제 RT 갱신을 요청해 새 AT 로 재시도
 *   3) 갱신이 일시 오류(네트워크·충돌·5xx)면 에러만 던지고 세션은 유지
 *   4) 갱신이 거부(401)되었거나 새 AT 도 401 이면 그때만 세션 종료 → 모달
 *   ※ 1) 만으로 포기하지 않는다. 과거에는 1) 재시도가 401 이면 곧바로 세션 종료로
 *      판정해, 갱신이 정상인데도 모달이 뜨는 오탐이 있었다.
 *
 * 변형:
 *   - authFetch<T>(url, options): JSON 응답 자동 파싱 → T 반환 (대부분의 API용)
 *   - authFetchRaw(url, options): Response 그대로 반환 (Blob/파일 다운로드용)
 *     인증/갱신/모달 흐름은 authFetch 와 동일.
 */

import { toast } from "sonner";
import {
  clearAuthTokensAcrossTabs,
  ensureFreshAccessTokenResult,
  refreshAccessTokenResult,
} from "@/lib/authRefreshClient";
import type { AccessTokenRefreshResult } from "@/lib/authRefreshPolicy";
import { notifySessionExpired } from "@/lib/authSessionEvents";
import { accessTokenMemberId, shouldRefreshAccessToken } from "@/lib/authSessionPolicy";
import { getStoredAccessToken } from "@/lib/authTokenStorage";
import { tokenExpiryLabel, traceAuth } from "@/lib/authTrace";

// ── 전역 상태 (메모리) ────────────────────────────────────────────────────────
// 폴백 경로(로그인 페이지 이동)를 동시 다발 401 에서 한 번만 트리거하기 위한 플래그
let redirectTriggered = false;

type SessionEndReason = "expired" | "unauthorized";

/**
 * 세션 종료 처리 — 화면을 유지한 채 재로그인 모달을 띄운다.
 *
 * 과거에는 곧바로 로그인 페이지로 이동시켰는데, 그 순간 사용자가 30분 동안 쓴
 * 내용이 통보 없이 사라졌다(실제 컴플레인). 이제는:
 *   1) 이 탭의 AT 정리 + 다른 탭에 AUTH_CLEARED 알림 (다른 탭도 모달만 띄움)
 *   2) SessionExpiredModal 이 마운트돼 있으면 모달 표시 → 재로그인 후 저장 재시도
 *   3) 모달 호스트가 없는 화면(예외적)에서만 로그인 페이지 이동 폴백
 */
function handleSessionEnded(reason: SessionEndReason, detail: string): void {
  if (typeof window === "undefined") return;
  // 로그인 화면 자체에서의 401 은 무한 루프 방지를 위해 무시
  if (window.location.pathname.startsWith("/auth/")) return;

  traceAuth("session-ended", { reason, detail });

  // 토큰을 지우기 전에 이 탭이 쓰던 계정을 기억해 둔다 (복구 후 계정 일치 확인용)
  const previousMemberId = accessTokenMemberId(getStoredAccessToken());

  // 잔여 토큰으로 다음 요청이 또 401 받지 않도록 정리
  clearAuthTokensAcrossTabs();

  if (notifySessionExpired({ reason, previousMemberId, detail })) return;

  redirectToLogin(reason);
}

/**
 * [폴백] 로그인 페이지로 이동 — SessionExpiredModal 이 없는 화면 전용.
 *
 * - 동시에 여러 API가 401을 받아도 redirectTriggered 플래그로 1회만 실행
 * - 토스트가 보일 시간 확보 후(0.8초) location.href 변경
 * - 현재 경로를 redirect 쿼리로 보존 → 로그인 성공 후 원위치 복귀
 */
function redirectToLogin(reason: SessionEndReason): void {
  if (redirectTriggered) return;
  redirectTriggered = true;

  toast.info(
    reason === "expired"
      ? "세션이 만료되었습니다. 다시 로그인해 주세요."
      : "로그인이 필요합니다."
  );

  const here = window.location.pathname + window.location.search;
  const redirect = encodeURIComponent(here);

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

/** 진단 기록용 — 쿼리스트링을 뗀 경로만 남긴다. */
function tracePath(url: string): string {
  return url.split("?")[0] ?? url;
}

/**
 * 한 번의 인증 요청 — 재시도까지 포함한 단일 실행 경로. 흐름은 파일 상단 "401 복구 사다리" 참조.
 */
async function authenticatedRequest(
  url: string,
  options: RequestInit | undefined,
  jsonDefault: boolean,
): Promise<Response> {
  const sendWith = (accessToken: string | null) =>
    fetch(url, { ...options, headers: requestHeaders(options, accessToken, jsonDefault) });

  // ── 0) 만료 임박/부재 시 선제 갱신 후 첫 요청 ─────────────────────────────
  const initialRefresh = await ensureFreshAccessTokenResult();
  const usedToken = initialRefresh.status === "success"
    ? initialRefresh.accessToken
    : getStoredAccessToken() || null;
  let response = await sendWith(usedToken);
  if (response.status !== 401) return response;

  let errorBody = await readAuthError(response);
  if (!isRecoverableSessionError(errorBody)) return response;

  const firstCode = String(errorBody.code);
  traceAuth("api-401", {
    path: tracePath(url),
    code: firstCode,
    usedExp: tokenExpiryLabel(usedToken ?? ""),
    storedExp: tokenExpiryLabel(getStoredAccessToken()),
    initial: initialRefresh.status,
  });

  // ── 1) 다른 탭/요청이 이미 갱신해 둔 더 새로운 AT 가 있으면 그것으로 먼저 재시도 ──
  //    네트워크 비용 없이 끝나는 흔한 경우. 단, 그 토큰이 클라이언트 기준으로도 이미
  //    만료라면 시도 자체가 무의미하므로 건너뛴다.
  const storedToken = getStoredAccessToken();
  const hasNewerStoredToken =
    !!storedToken && storedToken !== usedToken && !shouldRefreshAccessToken(storedToken);

  if (hasNewerStoredToken) {
    response = await sendWith(storedToken);
    if (response.status !== 401) {
      traceAuth("shortcut-retry", { result: response.status });
      return response;
    }
    errorBody = await readAuthError(response);
    traceAuth("shortcut-retry", { result: 401, code: String(errorBody.code) });
    if (!isRecoverableSessionError(errorBody)) return response;
    // 지름길이 실패해도 여기서 포기하지 않는다 — 아래에서 실제 갱신을 반드시 시도한다.
  }

  // ── 2) 서버에 실제 RT 갱신 요청 → 새 AT 로 재시도 ──────────────────────────
  const recovery: AccessTokenRefreshResult = await refreshAccessTokenResult();
  traceAuth("refresh-recover", {
    status: recovery.status,
    detail: recovery.status === "success" ? null : (recovery.detail ?? null),
  });

  if (recovery.status === "success") {
    response = await sendWith(recovery.accessToken);
    if (response.status !== 401) return response;

    errorBody = await readAuthError(response);
    if (!isRecoverableSessionError(errorBody)) return response;
    // 방금 발급받은 AT 까지 401 — 서버가 이 세션을 거부하는 상태다.
  }

  // ── 3) 네트워크·충돌·서버 일시 오류는 세션 종료가 아니다 ────────────────────
  //    모달을 띄우거나 다른 탭의 인증 정보를 지우지 않고, 다음 요청의 재시도를 허용한다.
  if (recovery.status === "transient") {
    throw new Error("로그인 상태를 확인하는 중 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
  }

  // ── 4) 진짜 세션 종료 → 모달 ─────────────────────────────────────────────
  const reason: SessionEndReason = errorBody.code === "UNAUTHORIZED" ? "unauthorized" : "expired";
  // 어떤 경로로 종료를 판정했는지 (모달 하단 "사유:" 에 표시 — 사용자 문의 대응용)
  const recoveryDetail = recovery.status === "success"
    ? `갱신 성공 후 재시도도 401 ${String(errorBody.code)}`
    : (recovery.detail ?? "refresh terminal");
  handleSessionEnded(reason, `API 401 ${firstCode} → ${recoveryDetail}`);

  // 호출부(mutation onError 등)가 토스트로 보여줄 메시지 — 작성 내용은 남아 있으니
  // "다시 로그인 후 저장을 다시 누르라"는 행동 지침을 담는다.
  throw new Error(
    reason === "expired"
      ? "세션이 만료되었습니다. 다시 로그인한 뒤 저장을 다시 눌러 주세요."
      : "로그인이 필요합니다. 다시 로그인한 뒤 저장을 다시 눌러 주세요."
  );
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
 * authFetch 와 같은 인증 흐름(토큰 갱신, 401 처리, 세션 만료 모달)을 따르되,
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
