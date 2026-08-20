/**
 * 브라우저 Refresh Token 쿠키 전환의 공통 정책.
 * 브라우저와 서버가 함께 쓰는 값만 두며 Next.js 런타임에는 의존하지 않는다.
 */

export const AUTH_COOKIE_MODE_HEADER = "x-specode-auth-mode";
export const AUTH_COOKIE_MODE_VALUE = "cookie";

export const DEVELOPMENT_REFRESH_COOKIE_NAME = "specode_rt";
export const PRODUCTION_REFRESH_COOKIE_NAME = "__Host-specode_rt";

type HeaderReader = Pick<Headers, "get">;

export type RefreshCredential = {
  token: string;
  source: "cookie" | "body";
};

export function isCookieAuthMode(headers: HeaderReader): boolean {
  return headers.get(AUTH_COOKIE_MODE_HEADER)?.toLowerCase() === AUTH_COOKIE_MODE_VALUE;
}

export function selectRefreshCredential(input: {
  cookieToken?: string | null;
  bodyToken?: string | null;
  cookieMode: boolean;
}): RefreshCredential | null {
  const cookieToken = input.cookieToken?.trim() || null;
  const bodyToken = input.bodyToken?.trim() || null;

  // 새 클라이언트는 HttpOnly 쿠키를 우선한다. 기존 클라이언트는 자신이 제출한
  // body RT를 우선해야 회전 결과를 한 번 더 받아 단계적으로 승계할 수 있다.
  if (input.cookieMode) {
    if (cookieToken) return { token: cookieToken, source: "cookie" };
    if (bodyToken) return { token: bodyToken, source: "body" };
  } else {
    if (bodyToken) return { token: bodyToken, source: "body" };
    if (cookieToken) return { token: cookieToken, source: "cookie" };
  }

  return null;
}

/** 쿠키로 인증한 응답에는 RT 원문을 절대 싣지 않는다. */
export function shouldReturnLegacyRefreshToken(
  credentialSource: RefreshCredential["source"],
  cookieMode: boolean,
): boolean {
  return credentialSource === "body" && !cookieMode;
}

export function refreshTokenCookieName(isProduction: boolean): string {
  return isProduction
    ? PRODUCTION_REFRESH_COOKIE_NAME
    : DEVELOPMENT_REFRESH_COOKIE_NAME;
}

export function refreshTokenCookieOptions(
  autoLoginYn: string,
  expiry: Date,
  isProduction: boolean,
) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict" as const,
    path: "/",
    ...(autoLoginYn === "Y" ? { expires: expiry } : {}),
  };
}

export function isTrustedAuthRequestOrigin(input: {
  origin: string | null;
  secFetchSite: string | null;
  requestOrigin: string;
  configuredAppUrl?: string;
  requireOrigin: boolean;
}): boolean {
  if (
    input.secFetchSite
    && input.secFetchSite !== "same-origin"
    && input.secFetchSite !== "none"
  ) {
    return false;
  }

  if (!input.origin) return !input.requireOrigin;

  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(input.origin).origin;
  } catch {
    return false;
  }

  const allowedOrigins = new Set<string>();
  try {
    allowedOrigins.add(new URL(input.requestOrigin).origin);
  } catch {
    return false;
  }
  if (input.configuredAppUrl) {
    try {
      allowedOrigins.add(new URL(input.configuredAppUrl).origin);
    } catch {
      return false;
    }
  }

  return allowedOrigins.has(normalizedOrigin);
}
