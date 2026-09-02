export type AccessTokenRefreshResult =
  | { status: "success"; accessToken: string }
  | { status: "terminal" }
  | { status: "transient" };

/** Refresh API의 401만 실제 로그인 세션 종료로 취급한다. */
export function classifyRefreshFailure(status: number): "terminal" | "transient" {
  return status === 401 ? "terminal" : "transient";
}
