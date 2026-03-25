/**
 * GET /api/auth/social/[provider]/authorize — OAuth 인증 URL 생성
 *
 * 역할:
 *   1. CSRF 방지용 nonce 생성 → oauth_state 쿠키 저장
 *   2. OAuth Provider 인증 URL 반환
 *
 * Path param: provider = 'google' | 'github'
 * Query:      action   = 'add' (로그인한 회원의 소셜 계정 추가 연동 시)
 *
 * state 형식:
 *   - 일반 로그인:   "provider:nonce"
 *   - 소셜 계정 추가: "provider:nonce:add"
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { apiError } from "@/lib/apiResponse";

const SUPPORTED_PROVIDERS = ["google", "github"] as const;
type Provider = (typeof SUPPORTED_PROVIDERS)[number];

type RouteParams = { params: Promise<{ provider: string }> };

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { provider } = await params;

  if (!SUPPORTED_PROVIDERS.includes(provider as Provider)) {
    return apiError("VALIDATION_ERROR", "지원하지 않는 소셜 로그인입니다.", 400);
  }

  // action=add:      이미 로그인한 회원이 소셜 계정을 추가 연동할 때
  // action=withdraw: 회원 탈퇴 시 소셜 계정으로 본인 재인증할 때
  const action = req.nextUrl.searchParams.get("action");

  const appUrl   = process.env.APP_URL ?? "http://localhost:3001";
  const redirect = `${appUrl}/auth/social/callback`;

  // CSRF 방지 nonce — 쿠키에 저장, state 파라미터에 포함
  const nonce = crypto.randomBytes(16).toString("hex");
  const state = (action === "add" || action === "withdraw")
    ? `${provider}:${nonce}:${action}`
    : `${provider}:${nonce}`;

  let authUrl: string;

  if (provider === "google") {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return apiError("CONFIG_ERROR", "Google 로그인이 설정되지 않았습니다.", 503);
    }
    const qs = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  redirect,
      response_type: "code",
      scope:         "openid email profile",
      state,
    });
    authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${qs}`;

  } else {
    // github
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      return apiError("CONFIG_ERROR", "GitHub 로그인이 설정되지 않았습니다.", 503);
    }
    const qs = new URLSearchParams({
      client_id:    clientId,
      redirect_uri: redirect,
      scope:        "user:email",
      state,
    });
    authUrl = `https://github.com/login/oauth/authorize?${qs}`;
  }

  // oauth_state 쿠키 저장 (HttpOnly, 5분 유효)
  const response = NextResponse.json({ data: { url: authUrl } });
  response.cookies.set("oauth_state", nonce, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   300,
    path:     "/",
  });
  return response;
}
