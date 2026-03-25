/**
 * authFetch — 인증된 API 호출 래퍼
 *
 * 역할:
 *   - sessionStorage의 access_token을 Authorization 헤더에 자동 포함
 *   - apiFetch 위에 얹는 얇은 레이어
 *
 * 사용 예:
 *   import { authFetch } from "@/lib/authFetch";
 *   const data = await authFetch<ProjectList>("/api/projects");
 */

import { apiFetch } from "@/lib/apiFetch";

export function authFetch<T>(url: string, options?: RequestInit): Promise<T> {
  // SSR 환경에서는 sessionStorage 접근 불가 — 빈 문자열로 처리
  const at =
    typeof window !== "undefined"
      ? (sessionStorage.getItem("access_token") ?? "")
      : "";

  return apiFetch<T>(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
      // AT가 있을 때만 Authorization 헤더 포함
      ...(at ? { Authorization: `Bearer ${at}` } : {}),
    },
  });
}
