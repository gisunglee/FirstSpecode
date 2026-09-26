/**
 * POST /api/auth/social/register — 소셜 신규 가입 완료 (REGISTER_REQUIRED 후속)
 *
 * 역할:
 *   1. socialToken 검증 → Provider 정보(식별자·이메일·이름·이미지) 추출
 *   2. 이름·약관 동의 검증
 *   3. 트랜잭션: tb_cm_member(ACTIVE) + tb_cm_social_account + tb_cm_member_consent + 세션/RT
 *   4. AT/RT 발급 (콜백의 옛 NEW 응답과 같은 형태)
 *
 * 콜백(/api/auth/social/callback)이 계정을 즉시 만들던 것을 2026-09-24 에 여기로 옮겼다 —
 * 동의 없이 계정이 생기는 흐름을 없애고, 이름을 사용자가 확인·수정할 기회를 주기 위해.
 *
 * Body: { socialToken: string, name: string, agreeTerms: true, agreePrivacy: true }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import {
  verifySocialToken,
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiryDate,
} from "@/lib/auth";
import {
  isTrustedAuthRequest,
  requestUsesCookieAuthMode,
  setRefreshTokenCookie,
} from "@/lib/authRefreshCookie";
import { getClientIp } from "@/lib/rateLimit";
import { validateRequiredConsents, recordRequiredConsents } from "@/lib/consent";
import { normalizeMemberName } from "@/lib/memberName";

export async function POST(request: NextRequest) {
  const cookieMode = requestUsesCookieAuthMode(request);
  if (!isTrustedAuthRequest(request, cookieMode)) {
    return apiError("CSRF_ERROR", "허용되지 않은 출처의 요청입니다.", 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { socialToken, name: nameInput } = (body ?? {}) as Record<string, unknown>;

  if (!socialToken || typeof socialToken !== "string") {
    return apiError("VALIDATION_ERROR", "소셜 토큰이 필요합니다.", 400);
  }

  // 토큰이 곧 "Google 이 이 사람의 이메일을 확인했다"는 증거 — 만료(10분)되면 처음부터 다시
  const payload = verifySocialToken(socialToken);
  if (!payload) {
    return apiError("INVALID_TOKEN", "인증이 만료되었습니다. 소셜 로그인을 다시 시도해 주세요.", 400);
  }

  const nameResult = normalizeMemberName(nameInput);
  if ("error" in nameResult) {
    return apiError("VALIDATION_ERROR", nameResult.error, 400);
  }
  const consentError = validateRequiredConsents((body ?? {}) as Record<string, unknown>);
  if (consentError) {
    return apiError("VALIDATION_ERROR", consentError, 400);
  }

  const ipAddr    = getClientIp(request);
  const userAgent = request.headers.get("user-agent") ?? "unknown";

  try {
    // 콜백 판정 이후 10분 사이에 상황이 바뀌었을 수 있다(같은 탭 두 개, 다른 경로로 먼저 가입 등).
    // 콜백과 같은 순서로 다시 확인해 중복 계정을 막는다.
    const existingSocial = await prisma.tbCmSocialAccount.findUnique({
      where: {
        provdr_code_provdr_user_id: { provdr_code: payload.provdrCode, provdr_user_id: payload.provdrUserId },
      },
      select: { mber_id: true },
    });
    if (existingSocial) {
      return apiError("ALREADY_REGISTERED", "이미 가입된 소셜 계정입니다. 로그인해 주세요.", 409);
    }

    const existingMember = await prisma.tbCmMember.findUnique({
      where:  { email_addr: payload.email },
      select: { mber_id: true },
    });
    if (existingMember) {
      return apiError(
        "DUPLICATE_EMAIL",
        "이미 가입된 이메일입니다. 로그인한 뒤 프로필에서 소셜 계정을 연동해 주세요.",
        409,
      );
    }

    const rt       = generateRefreshToken();
    const rtHash   = hashRefreshToken(rt);
    const rtExpiry = refreshTokenExpiryDate();

    const { mberId, sesnId } = await prisma.$transaction(async (tx) => {
      // 소셜 가입은 Provider 가 이메일 소유를 확인했으므로 바로 ACTIVE (이메일 가입의 UNVERIFIED 와 다름)
      const member = await tx.tbCmMember.create({
        data: {
          email_addr:      payload.email,
          mber_sttus_code: "ACTIVE",
          mber_nm:         nameResult.name,
          ...(payload.imageUrl ? { profl_img_url: payload.imageUrl } : {}),
        },
      });
      await tx.tbCmSocialAccount.create({
        data: {
          mber_id:           member.mber_id,
          provdr_code:       payload.provdrCode,
          provdr_user_id:    payload.provdrUserId,
          provdr_email_addr: payload.email,
        },
      });
      await recordRequiredConsents(tx, member.mber_id, ipAddr);

      const sesn = await tx.tbCmMemberSession.create({
        data: { mber_id: member.mber_id, device_info_cn: userAgent, ip_addr: ipAddr },
      });
      await tx.tbCmRefreshToken.create({
        data: { mber_id: member.mber_id, token_hash_val: rtHash, expiry_dt: rtExpiry, sesn_id: sesn.sesn_id },
      });
      return { mberId: member.mber_id, sesnId: sesn.sesn_id };
    });

    const accessToken = signAccessToken({ mberId, email: payload.email, sesnId });
    const response = apiSuccess(
      { accessToken, ...(!cookieMode ? { refreshToken: rt } : {}) },
      201,
    );
    return setRefreshTokenCookie(response, rt, rtExpiry, "N");

  } catch (err) {
    console.error("[POST /api/auth/social/register] 오류:", err);
    return apiError("DB_ERROR", "가입 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
}
