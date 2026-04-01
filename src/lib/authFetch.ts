/**
 * authFetch — 인증된 API 호출 래퍼
 *
 * 역할:
 *   - Authorization 헤더 자동 포함
 *   - 401 (TOKEN_EXPIRED) 응답 시 자동 토큰 갱신 및 재시도 (FID-00014)
 *   - 여러 API가 동시에 만료되었을 때 갱신 요청이 한 번만 가도록 제어 (Lock)
 */

import { apiFetch } from "@/lib/apiFetch";

// ── 로컬 스토리지 키 관리 ───────────────────────────────────────────────────
const LS_REFRESH_TOKEN = "lc_refresh_token";

// ── 전역 상태 (메모리) ────────────────────────────────────────────────────────
// 동시 다발적으로 401 발생 시 한 번만 갱신하기 위한 Promise 보관용
let refreshPromise: Promise<string | null> | null = null;

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

    // 2. 만료 에러(401) 발생 시 자동 갱신 시도
    if (response.status === 401) {
      const errorBody = await response.clone().json().catch(() => ({}));
      // 토큰 만료 케이스만 갱신 시도 (그 외는 단순 권한 없음 처리)
      if (errorBody.code === "TOKEN_EXPIRED") {
        const newAT = await handleRefreshToken();
        if (newAT) {
          // 갱신 성공 시 새 토큰으로 헤더 교체 후 재시도
          headers["Authorization"] = `Bearer ${newAT}`;
          return apiFetch<T>(url, { ...options, headers });
        }
      }
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
      // 만료된 RT라면 로그아웃 처리 (토큰 완전 삭제 후 로그인 페이지로)
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("access_token");
        sessionStorage.removeItem("refresh_token");
        localStorage.removeItem(LS_REFRESH_TOKEN);
        // 강제 리다이렉트 (필요 시 주석 해제)
        // window.location.href = "/auth/login?reason=expired";
      }
      return null;
    } finally {
      // 갱신 작업 완료 시 Promise 초기화
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}
