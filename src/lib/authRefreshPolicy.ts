export type AccessTokenRefreshResult =
  | { status: "success"; accessToken: string }
  /** detail: 진단용 — Refresh API 가 돌려준 HTTP 상태와 code (예: "401 INVALID_TOKEN") */
  | { status: "terminal"; detail?: string }
  | { status: "transient"; detail?: string };

/** Refresh API의 401만 실제 로그인 세션 종료로 취급한다. */
export function classifyRefreshFailure(status: number): "terminal" | "transient" {
  return status === 401 ? "terminal" : "transient";
}
