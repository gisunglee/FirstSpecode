/**
 * 로그인 세션 시간 정책과 Access Token 만료 판정.
 *
 * 서버의 JWT 발급 시간과 브라우저의 선제 갱신 기준이 어긋나지 않도록
 * 런타임 의존성이 없는 이 파일에서 한 번만 정의한다.
 */

/** Access Token 유효 시간: 발급 후 30분. */
export const ACCESS_TOKEN_EXPIRES_SECONDS = 30 * 60;

/** 만료 직전 요청이 401을 받지 않도록 2분 전에 선제 갱신한다. */
export const ACCESS_TOKEN_REFRESH_LEEWAY_SECONDS = 2 * 60;

/** 열린 화면에서 세션 상태를 확인하는 단일 주기: 1분. */
export const AUTH_SESSION_CHECK_INTERVAL_MS = 60 * 1000;

/** JWT payload의 exp를 밀리초 시각으로 읽는다. 서명 검증은 서버가 담당한다. */
export function accessTokenExpiresAtMs(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1]) return null;

    const base64 = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    const binary = globalThis.atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as { exp?: unknown };

    return typeof payload.exp === "number" && Number.isFinite(payload.exp)
      ? payload.exp * 1000
      : null;
  } catch {
    return null;
  }
}

/** 토큰이 없거나 손상됐거나 갱신 여유 구간에 들어오면 true. */
export function shouldRefreshAccessToken(
  token: string,
  nowMs = Date.now(),
  leewaySeconds = ACCESS_TOKEN_REFRESH_LEEWAY_SECONDS,
): boolean {
  if (!token) return true;
  const expiresAtMs = accessTokenExpiresAtMs(token);
  if (expiresAtMs === null) return true;
  return expiresAtMs - nowMs <= leewaySeconds * 1000;
}
