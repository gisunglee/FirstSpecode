/**
 * GET /api/member/profile — 프로필 정보 조회 (FID-00037)
 *
 * 역할:
 *   - 현재 로그인 회원의 이름·이메일·프로필 이미지·소셜 연동 상태·비밀번호 설정 여부 반환
 *
 * Header: Authorization: Bearer <AT>
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireAuth } from "@/lib/requireAuth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const member = await prisma.tbCmMember.findUnique({
      where:  { mber_id: auth.mberId },
      select: {
        mber_nm:           true,
        email_addr:        true,
        profl_img_url:     true,
        pswd_hash:         true,
        plan_code:         true,   // 시스템 플랜 (FREE/PRO/TEAM/ENTERPRISE) — GNB 프로필 배지용
        asignee_view_mode: true,   // 전역 담당자 필터 모드 (all | me) — GNB 토글 상태
        socialAccounts: {
          select: { provdr_code: true },
        },
      },
    });

    if (!member) {
      return apiError("NOT_FOUND", "회원 정보를 찾을 수 없습니다.", 404);
    }

    // 소셜 연동 상태: { google: boolean, github: boolean }
    const linkedProviders = member.socialAccounts.map((s) => s.provdr_code.toLowerCase());

    return apiSuccess({
      name:             member.mber_nm ?? "",
      email:            member.email_addr ?? "",
      profileImage:     member.profl_img_url ?? null,
      plan:             member.plan_code ?? "FREE",
      assigneeViewMode: member.asignee_view_mode ?? "all",
      hasPassword:      member.pswd_hash !== null,
      hasSocialAccounts: {
        google: linkedProviders.includes("google"),
        github: linkedProviders.includes("github"),
      },
    });

  } catch (err) {
    console.error("[GET /api/member/profile] 오류:", err);
    return apiError("DB_ERROR", "프로필 조회 중 오류가 발생했습니다.", 500);
  }
}
