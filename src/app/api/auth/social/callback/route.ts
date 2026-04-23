/**
 * POST /api/auth/social/callback — OAuth 콜백 처리 (FID-00200)
 *
 * 역할:
 *   1. state 검증 (CSRF)
 *   2. Provider에 code → Access Token 교환
 *   3. Provider에서 사용자 정보 조회
 *   4. 결과 분기:
 *      - EXISTING:     기존 소셜 계정 → AT/RT 발급
 *      - LINK_REQUIRED: 동일 이메일 기존 계정 존재 → socialToken 발급
 *      - NEW:          신규 → 계정 생성 + AT/RT 발급
 *      - ADD_SOCIAL:   action=add (로그인 회원의 소셜 추가) → socialToken 발급
 *                      클라이언트가 이후 POST /api/member/social/link 호출
 *
 * Body: { code: string, state: string }
 * 응답: { data: { resultType, accessToken?, refreshToken?, socialToken?, email?, provider? } }
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/apiResponse";
import {
  signAccessToken,
  signSocialToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiryDate,
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { code, state } = (body ?? {}) as Record<string, unknown>;

  if (!code || typeof code !== "string" || !state || typeof state !== "string") {
    return apiError("VALIDATION_ERROR", "인증 요청이 유효하지 않습니다.", 400);
  }

  // state 형식: "provider:nonce:action:redirect"
  const parts      = state.split(":");
  const provider   = parts[0];
  const nonce      = parts[1];
  const action     = parts[2] || null; // "add", "withdraw" 등
  const redirectTo = parts[3] || null; // 예: "/invite/accept?token=..."

  if (!provider || !nonce || !["google", "github"].includes(provider)) {
    return apiError("VALIDATION_ERROR", "인증 요청이 유효하지 않습니다.", 400);
  }

  // CSRF 검증 — 쿠키에 저장된 nonce와 비교
  const cookieStore = await cookies();
  const storedNonce = cookieStore.get("oauth_state")?.value;

  if (!storedNonce || storedNonce !== nonce) {
    return apiError("CSRF_ERROR", "인증 요청이 유효하지 않습니다. 다시 시도해 주세요.", 400);
  }

  const appUrl    = process.env.APP_URL ?? "http://localhost:3000";
  const redirectUri = `${appUrl}/auth/social/callback`;
  const ipAddr    = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const userAgent = request.headers.get("user-agent") ?? "unknown";

  let provdrUserId:   string;
  let provdrEmail:    string | null = null;
  let provdrName:     string | null = null;
  let provdrImageUrl: string | null = null;

  try {
    if (provider === "google") {
      // ── Google code → token 교환 ──
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method:  "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body:    new URLSearchParams({
          code,
          client_id:     process.env.GOOGLE_CLIENT_ID     ?? "",
          client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
          redirect_uri:  redirectUri,
          grant_type:    "authorization_code",
        }),
      });

      if (!tokenRes.ok) {
        return apiError("OAUTH_ERROR", "소셜 인증에 실패했습니다. 다시 시도해 주세요.", 400);
      }
      const { access_token } = await tokenRes.json();

      // ── Google 사용자 정보 조회 ──
      const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      if (!userRes.ok) {
        return apiError("PROVIDER_ERROR", "소셜 서비스 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.", 502);
      }
      const userData = await userRes.json();
      provdrUserId   = userData.sub;
      provdrEmail    = userData.email    ?? null;
      // Google 이름 우선순위: name → given_name+family_name 조합
      // (비즈니스 계정 등에서 name이 비어 오는 케이스 방어)
      // 최종 fallback(이메일 앞자리)은 NEW 가입 블록에서 일괄 처리한다.
      const combinedName = [userData.given_name, userData.family_name].filter(Boolean).join(" ");
      provdrName     = (userData.name as string | undefined) || combinedName || null;
      provdrImageUrl = userData.picture  ?? null;

    } else {
      // ── GitHub code → token 교환 ──
      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method:  "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body:    JSON.stringify({
          code,
          client_id:     process.env.GITHUB_CLIENT_ID     ?? "",
          client_secret: process.env.GITHUB_CLIENT_SECRET ?? "",
          redirect_uri:  redirectUri,
        }),
      });

      if (!tokenRes.ok) {
        return apiError("OAUTH_ERROR", "소셜 인증에 실패했습니다. 다시 시도해 주세요.", 400);
      }
      const { access_token } = await tokenRes.json();

      // ── GitHub 사용자 정보 조회 ──
      const userRes = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${access_token}`, "User-Agent": "SPECODE" },
      });

      if (!userRes.ok) {
        return apiError("PROVIDER_ERROR", "소셜 서비스 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.", 502);
      }
      const userData = await userRes.json();
      provdrUserId   = String(userData.id);
      provdrEmail    = userData.email ?? null;
      // GitHub 이름 우선순위: name(표시 이름) → login(아이디)
      // 표시 이름을 설정하지 않은 사용자도 많아 login을 fallback으로 사용
      provdrName     = userData.name ?? userData.login ?? null;
      provdrImageUrl = userData.avatar_url ?? null;

      // GitHub 이메일이 비공개인 경우 emails 엔드포인트로 보완
      if (!provdrEmail) {
        const emailsRes = await fetch("https://api.github.com/user/emails", {
          headers: { Authorization: `Bearer ${access_token}`, "User-Agent": "SPECODE" },
        });
        if (emailsRes.ok) {
          const emails: { email: string; primary: boolean; verified: boolean }[] = await emailsRes.json();
          provdrEmail = emails.find((e) => e.primary && e.verified)?.email ?? null;
        }
      }
    }

    if (!provdrEmail) {
      return apiError("PROVIDER_ERROR", "소셜 계정에서 이메일을 가져올 수 없습니다.", 502);
    }

    const provdrCode = provider.toUpperCase(); // 'GOOGLE' | 'GITHUB'

    // ── WITHDRAW_SOCIAL: 회원 탈퇴 시 소셜 재인증 ──
    // socialToken만 발급 → 클라이언트가 DELETE /api/member/me에 전달
    if (action === "withdraw") {
      const socialToken = signSocialToken({ provdrCode, provdrUserId, email: provdrEmail! });
      const res = NextResponse.json({
        data: { resultType: "WITHDRAW_SOCIAL", socialToken, redirectTo },
      });
      res.cookies.delete("oauth_state");
      return res;
    }

    // ── ADD_SOCIAL: 이미 로그인한 회원의 소셜 계정 추가 연동 ──
    // socialToken을 발급해 클라이언트에 반환 → 클라이언트가 AT와 함께 /api/member/social/link 호출
    if (action === "add") {
      // 이 Provider 계정이 이미 다른 회원에 연동되어 있는지 확인
      const alreadyLinked = await prisma.tbCmSocialAccount.findUnique({
        where: {
          provdr_code_provdr_user_id: { provdr_code: provdrCode, provdr_user_id: provdrUserId },
        },
        select: { mber_id: true },
      });

      if (alreadyLinked) {
        const res = NextResponse.json({ data: { resultType: "ADD_SOCIAL_DUPLICATE" } });
        res.cookies.delete("oauth_state");
        return res;
      }

      const socialToken = signSocialToken({ provdrCode, provdrUserId, email: provdrEmail! });
      const res = NextResponse.json({
        data: { resultType: "ADD_SOCIAL", socialToken, provider: provdrCode.toLowerCase(), redirectTo },
      });
      res.cookies.delete("oauth_state");
      return res;
    }

    // ── 기존 소셜 계정 조회 ──
    const existingSocial = await prisma.tbCmSocialAccount.findUnique({
      where: {
        provdr_code_provdr_user_id: { provdr_code: provdrCode, provdr_user_id: provdrUserId },
      },
      include: { member: { select: { mber_id: true, email_addr: true } } },
    });

    if (existingSocial) {
      // EXISTING — 기존 소셜 로그인
      const rt      = generateRefreshToken();
      const rtHash  = hashRefreshToken(rt);
      const rtExpiry = refreshTokenExpiryDate();

      const sesnId = await prisma.$transaction(async (tx) => {
        const sesn = await tx.tbCmMemberSession.create({
          data: { mber_id: existingSocial.mber_id, device_info_cn: userAgent, ip_addr: ipAddr },
        });
        await tx.tbCmRefreshToken.create({
          data: { mber_id: existingSocial.mber_id, token_hash_val: rtHash, expiry_dt: rtExpiry, sesn_id: sesn.sesn_id },
        });
        return sesn.sesn_id;
      });

      const at  = signAccessToken({ mberId: existingSocial.mber_id, email: existingSocial.member.email_addr ?? "", sesnId });
      const res = NextResponse.json({ data: { resultType: "EXISTING", accessToken: at, refreshToken: rt, redirectTo } });
      res.cookies.delete("oauth_state");
      return res;
    }

    // ── 동일 이메일 기존 계정 조회 ──
    const existingMember = await prisma.tbCmMember.findUnique({
      where:  { email_addr: provdrEmail },
      select: { mber_id: true },
    });

    if (existingMember) {
      // LINK_REQUIRED — 연동 확인 필요
      const socialToken = signSocialToken({ provdrCode, provdrUserId, email: provdrEmail });
      const res = NextResponse.json({ data: { resultType: "LINK_REQUIRED", socialToken, email: provdrEmail } });
      res.cookies.delete("oauth_state");
      return res;
    }

    // NEW — 신규 가입 처리
    const rt      = generateRefreshToken();
    const rtHash  = hashRefreshToken(rt);
    const rtExpiry = refreshTokenExpiryDate();

    // Provider가 이름을 주지 않은 경우(예: Google 계정에 이름 미설정,
    // GitHub 표시 이름 없음) 이메일 앞자리를 대체 회원명으로 사용한다.
    // 회원명이 NULL이면 GNB/프로필 등 화면에서 공백으로 보이는 UX 이슈가 발생하므로
    // 항상 값이 채워지도록 보장한다.
    const fallbackName = provdrEmail!.split("@")[0];
    const mberNm       = provdrName?.trim() || fallbackName;

    const { newMember, sesnId } = await prisma.$transaction(async (tx) => {
      const member = await tx.tbCmMember.create({
        data: {
          email_addr:    provdrEmail!,
          mber_sttus_code: "ACTIVE",
          mber_nm:       mberNm,
          ...(provdrImageUrl && { profl_img_url: provdrImageUrl }),
        },
      });
      await tx.tbCmSocialAccount.create({
        data: {
          mber_id:           member.mber_id,
          provdr_code:       provdrCode,
          provdr_user_id:    provdrUserId,
          provdr_email_addr: provdrEmail,
        },
      });
      const sesn = await tx.tbCmMemberSession.create({
        data: { mber_id: member.mber_id, device_info_cn: userAgent, ip_addr: ipAddr },
      });
      await tx.tbCmRefreshToken.create({
        data: { mber_id: member.mber_id, token_hash_val: rtHash, expiry_dt: rtExpiry, sesn_id: sesn.sesn_id },
      });
      return { newMember: member, sesnId: sesn.sesn_id };
    });

    const at  = signAccessToken({ mberId: newMember.mber_id, email: provdrEmail!, sesnId });
    const res = NextResponse.json({ data: { resultType: "NEW", accessToken: at, refreshToken: rt, redirectTo } });
    res.cookies.delete("oauth_state");
    return res;

  } catch (err) {
    console.error("[POST /api/auth/social/callback] 오류:", err);
    return apiError("DB_ERROR", "로그인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
}
