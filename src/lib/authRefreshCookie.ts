/** 서버 전용 Refresh Token 쿠키 입출력 헬퍼. */

import type { NextRequest, NextResponse } from "next/server";
import {
  isCookieAuthMode,
  isTrustedAuthRequestOrigin,
  refreshTokenCookieName,
  refreshTokenCookieOptions,
  selectRefreshCredential,
} from "@/lib/authCookiePolicy";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function requestUsesCookieAuthMode(request: NextRequest): boolean {
  return isCookieAuthMode(request.headers);
}

export function readRequestRefreshCredential(
  request: NextRequest,
  bodyToken?: unknown,
) {
  const cookieName = refreshTokenCookieName(isProduction());
  const cookieToken = request.cookies.get(cookieName)?.value ?? null;

  return selectRefreshCredential({
    cookieToken,
    bodyToken: typeof bodyToken === "string" ? bodyToken : null,
    cookieMode: requestUsesCookieAuthMode(request),
  });
}

export function isTrustedAuthRequest(
  request: NextRequest,
  requireOrigin: boolean,
): boolean {
  return isTrustedAuthRequestOrigin({
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    requestOrigin: request.nextUrl.origin,
    configuredAppUrl: process.env.APP_URL,
    requireOrigin,
  });
}

export function setRefreshTokenCookie(
  response: NextResponse,
  token: string,
  expiry: Date,
  autoLoginYn: string,
): NextResponse {
  const production = isProduction();
  response.cookies.set(
    refreshTokenCookieName(production),
    token,
    refreshTokenCookieOptions(autoLoginYn, expiry, production),
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function clearRefreshTokenCookie(response: NextResponse): NextResponse {
  const production = isProduction();
  response.cookies.set(refreshTokenCookieName(production), "", {
    ...refreshTokenCookieOptions("N", new Date(0), production),
    expires: new Date(0),
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
