/**
 * GET /api/auth/email/check — 이메일 중복 확인 (FID-00002)
 *
 * 역할:
 *   - tb_cm_member.email_addr 기준 중복 여부 반환
 *   - 회원가입 폼 blur 이벤트에서 호출
 *
 * Query: ?email=xxx@yyy.com
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get("email");

  if (!email) {
    return apiError("VALIDATION_ERROR", "이메일을 입력해 주세요.", 400);
  }

  try {
    const existing = await prisma.tbCmMember.findUnique({
      where: { email_addr: email },
      select: { mber_id: true },
    });

    return apiSuccess({ isDuplicate: !!existing });
  } catch (err) {
    console.error("[GET /api/auth/email/check] DB 오류:", err);
    return apiError("DB_ERROR", "확인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
}
