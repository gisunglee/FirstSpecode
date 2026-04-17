/**
 * POST /api/member/social/link — 소셜 계정 연동 추가 (FID-00042)
 *
 * 역할:
 *   1. AT로 현재 회원 확인
 *   2. socialToken 검증 → Provider 정보 추출
 *   3. 이미 해당 회원에 연동된 Provider → 409
 *   4. tb_cm_social_account INSERT
 *
 * Body: { provider: string, socialToken: string }
 * Header: Authorization: Bearer <AT>
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireAuth } from "@/lib/requireAuth";
import { verifySocialToken } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { provider, socialToken } = (body ?? {}) as Record<string, unknown>;

  if (!provider || typeof provider !== "string") {
    return apiError("VALIDATION_ERROR", "provider가 필요합니다.", 400);
  }
  if (!socialToken || typeof socialToken !== "string") {
    return apiError("VALIDATION_ERROR", "socialToken이 필요합니다.", 400);
  }

  // socialToken 검증
  const social = verifySocialToken(socialToken);
  if (!social) {
    return apiError("INVALID_TOKEN", "유효하지 않은 소셜 토큰입니다.", 400);
  }

  const provdrCode = social.provdrCode;

  try {
    // 이미 해당 Provider가 연동된 건지 확인
    const existing = await prisma.tbCmSocialAccount.findUnique({
      where: {
        provdr_code_provdr_user_id: {
          provdr_code:    provdrCode,
          provdr_user_id: social.provdrUserId,
        },
      },
      select: { mber_id: true },
    });

    if (existing) {
      if (existing.mber_id === auth.mberId) {
        return apiError("DUPLICATE_SOCIAL", "이미 연동된 소셜 계정입니다.", 409);
      }
      // 다른 회원에 연동된 계정
      return apiError("DUPLICATE_SOCIAL", "이미 다른 계정에 연동된 소셜 계정입니다.", 409);
    }

    await prisma.tbCmSocialAccount.create({
      data: {
        mber_id:           auth.mberId,
        provdr_code:       provdrCode,
        provdr_user_id:    social.provdrUserId,
        provdr_email_addr: social.email ?? null,
      },
    });

    return apiSuccess({ provider: provdrCode.toLowerCase() });

  } catch (err) {
    console.error("[POST /api/member/social/link] 오류:", err);
    return apiError("DB_ERROR", "연동 중 오류가 발생했습니다.", 500);
  }
}
