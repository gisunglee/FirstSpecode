/**
 * DELETE /api/member/social/unlink — 소셜 계정 연동 해제 (FID-00043)
 *
 * 역할:
 *   1. 마지막 로그인 수단 여부 확인 (비밀번호 없고 소셜 1개면 해제 불가)
 *   2. tb_cm_social_account DELETE
 *
 * Body: { provider: string }
 * Header: Authorization: Bearer <AT>
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireAuth } from "@/lib/requireAuth";

export async function DELETE(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { provider } = (body ?? {}) as Record<string, unknown>;

  if (!provider || typeof provider !== "string") {
    return apiError("VALIDATION_ERROR", "provider가 필요합니다.", 400);
  }

  const provdrCode = provider.toUpperCase();

  try {
    // 마지막 로그인 수단 여부 확인
    const member = await prisma.tbCmMember.findUnique({
      where:  { mber_id: auth.mberId },
      select: {
        pswd_hash:      true,
        socialAccounts: { select: { social_acnt_id: true } },
      },
    });

    if (!member) {
      return apiError("NOT_FOUND", "회원 정보를 찾을 수 없습니다.", 404);
    }

    // 비밀번호도 없고 소셜 계정이 1개뿐이면 해제 불가 (로그인 수단이 사라짐)
    if (!member.pswd_hash && member.socialAccounts.length <= 1) {
      return apiError("LAST_LOGIN_METHOD", "마지막 로그인 수단은 해제할 수 없습니다.", 400);
    }

    // 해제 대상 계정 조회
    const target = await prisma.tbCmSocialAccount.findFirst({
      where: { mber_id: auth.mberId, provdr_code: provdrCode },
    });

    if (!target) {
      return apiError("NOT_FOUND", "연동된 소셜 계정을 찾을 수 없습니다.", 404);
    }

    await prisma.tbCmSocialAccount.delete({
      where: { social_acnt_id: target.social_acnt_id },
    });

    return apiSuccess({ provider: provider.toLowerCase() });

  } catch (err) {
    console.error("[DELETE /api/member/social/unlink] 오류:", err);
    return apiError("DB_ERROR", "연동 해제 중 오류가 발생했습니다.", 500);
  }
}
