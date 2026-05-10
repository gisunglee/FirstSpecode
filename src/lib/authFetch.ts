/**
 * authFetch — 인증된 API 호출 래퍼
 *
 * 역할:
 *   - Authorization 헤더 자동 포함
 *   - 401 (TOKEN_EXPIRED) 응답 시 자동 토큰 갱신 및 재시도 (FID-00014)
 *   - 여러 API가 동시에 만료되었을 때 갱신 요청이 한 번만 가도록 제어 (Lock)
 *   - RT 갱신 실패 / UNAUTHORIZED 응답 시 토큰 정리 후 로그인 페이지로 자동 이동
 *
 * 변형:
 *   - authFetch<T>(url, options): JSON 응답 자동 파싱 → T 반환 (대부분의 API용)
 *   - authFetchRaw(url, options): Response 그대로 반환 (Blob/파일 다운로드용)
 *     인증/갱신/리다이렉트 흐름은 authFetch 와 동일.
 */

import { toast } from "sonner";
import { apiFetch } from "@/lib/apiFetch";

// ── 로컬 스토리지 키 관리 ───────────────────────────────────────────────────
const LS_REFRESH_TOKEN = "lc_refresh_token";

// ── 전역 상태 (메모리) ────────────────────────────────────────────────────────
// 동시 다발적으로 401 발생 시 한 번만 갱신하기 위한 Promise 보관용
let refreshPromise: Promise<string | null> | null = null;
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
  sessionStorage.removeItem("access_token");
  sessionStorage.removeItem("refresh_token");
  localStorage.removeItem(LS_REFRESH_TOKEN);

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

export async function authFetch<T>(url: string, options?: RequestInit): Promise<T> {
  // SSR 환경에서는 sessionStorage 접근 불가 — 빈 문자열로 처리
  const getAccessToken = () =>
    typeof window !== "undefined" ? (sessionStorage.getItem("access_token") ?? "") : "";

  // 1. 초기 요청 시도
  const at = getAccessToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options?.headers ?? {}),
    ...(at ? { Authorization: `Bearer ${at}` } : {}),
  } as Record<string, string>;

  try {
    const response = await fetch(url, { ...options, headers });

    // 2. 401 처리 — 코드별 분기
    if (response.status === 401) {
      const errorBody = await response.clone().json().catch(() => ({}));

      if (errorBody.code === "TOKEN_EXPIRED") {
        // AT 만료 → RT로 갱신 시도
        const newAT = await handleRefreshToken();
        if (newAT) {
          // 갱신 성공 시 새 토큰으로 헤더 교체 후 재시도
          headers["Authorization"] = `Bearer ${newAT}`;
          return apiFetch<T>(url, { ...options, headers });
        }
        // 갱신 실패 → 로그인 페이지로 이동
        redirectToLogin("expired");
        throw new Error("세션이 만료되었습니다. 다시 로그인해 주세요.");
      }

      if (errorBody.code === "UNAUTHORIZED") {
        // 토큰이 아예 없거나 검증 실패 — 갱신 시도 의미 없음, 즉시 로그인 이동
        redirectToLogin("unauthorized");
        throw new Error(errorBody.message || "로그인이 필요합니다.");
      }

      // INVALID_API_KEY 등 그 외 401은 UI 흐름이 아니므로 일반 에러로 throw
    }

    // 3. 정상 응답 또는 갱신 불필요 시 일반 apiFetch와 동일하게 결과 반환
    if (!response.ok) {
      let msg = `요청 실패 (${response.status})`;
      try {
        const err = await response.json();
        if (err.message) msg = err.message;
      } catch {}
      throw new Error(msg);
    }

    return response.json() as Promise<T>;
  } catch (err) {
    // 이미 갱신 후 재시도 중 발생한 에러는 상위로 전파
    throw err;
  }
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
  const getAccessToken = () =>
    typeof window !== "undefined" ? (sessionStorage.getItem("access_token") ?? "") : "";

  const at = getAccessToken();
  // Blob 다운로드는 Content-Type 을 강제하지 않는다 (서버가 정함).
  // authFetch 가 Content-Type: application/json 을 강제하던 것과 다른 점.
  const headers = {
    ...(options?.headers ?? {}),
    ...(at ? { Authorization: `Bearer ${at}` } : {}),
  } as Record<string, string>;

  const response = await fetch(url, { ...options, headers });

  // 401 처리 — authFetch 와 동일한 분기
  if (response.status === 401) {
    const errorBody = await response.clone().json().catch(() => ({}));

    if (errorBody.code === "TOKEN_EXPIRED") {
      const newAT = await handleRefreshToken();
      if (newAT) {
        headers["Authorization"] = `Bearer ${newAT}`;
        // 재시도는 fetch 직접 호출 — 또 한번 401 이 오면 갱신 루프 방지를 위해 여기서 끝
        return fetch(url, { ...options, headers });
      }
      redirectToLogin("expired");
      throw new Error("세션이 만료되었습니다. 다시 로그인해 주세요.");
    }

    if (errorBody.code === "UNAUTHORIZED") {
      redirectToLogin("unauthorized");
      throw new Error(errorBody.message || "로그인이 필요합니다.");
    }
  }

  // 그 외(2xx/4xx/5xx)는 호출자가 res.ok 와 res.json/blob 으로 처리
  return response;
}

/**
 * handleRefreshToken — 토큰 갱신 프로세스 통합 관리
 */
async function handleRefreshToken(): Promise<string | null> {
  // 이미 다른 요청에 의해 갱신 작업이 진행 중이라면 그 결과(Promise)를 함께 기다림 (Lock 역할)
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      if (typeof window === "undefined") return null;

      // 1. RT 위치 파악 (기억하기 체크 여부에 따라 분산 저장됨)
      const rt = localStorage.getItem(LS_REFRESH_TOKEN) 
              ?? sessionStorage.getItem("refresh_token") 
              ?? "";

      if (!rt) throw new Error("RT_NOT_FOUND");

      // 2. 갱신 API 호출
      const res = await fetch("/api/auth/token/refresh", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ refreshToken: rt }),
      });

      if (!res.ok) throw new Error("REFRESH_FAILED");

      const body = await res.json();
      const newAT = body.data.accessToken;
      const newRT = body.data.refreshToken;

      // 3. 새 토큰 저장
      sessionStorage.setItem("access_token", newAT);
      if (localStorage.getItem(LS_REFRESH_TOKEN)) {
        localStorage.setItem(LS_REFRESH_TOKEN, newRT);
      } else {
        sessionStorage.setItem("refresh_token", newRT);
      }

      return newAT;
    } catch (err) {
      console.warn("[authFetch] 자동 로그인 연장에 실패했습니다.", err);
      // 토큰 정리 + 로그인 페이지 이동은 호출부(401 분기)에서 redirectToLogin() 으로 처리.
      // 여기서 또 정리하면 redirectTriggered 플래그가 동작하기 전에 토큰이 사라져
      // 토스트 메시지 노출 타이밍을 놓칠 수 있음 — null 만 반환하고 상위에서 처리하게 둠.
      return null;
    } finally {
      // 갱신 작업 완료 시 Promise 초기화
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}
