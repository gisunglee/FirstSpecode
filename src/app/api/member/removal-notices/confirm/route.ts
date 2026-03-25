/**
 * POST /api/member/removal-notices/confirm — 제거 안내 확인 처리 (FID-00091)
 *
 * 역할:
 *   - 해당 회원의 미확인 제거 안내 전체를 일괄 확인 처리
 *   - cnfrm_yn = 'Y', cnfrm_dt = NOW()
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    await prisma.tbPjMemberRemovalNotice.updateMany({
      where: {
        mber_id:  auth.mberId,
        cnfrm_yn: "N",
      },
      data: {
        cnfrm_yn: "Y",
        cnfrm_dt: new Date(),
      },
    });

    return apiSuccess({ ok: true });
  } catch (err) {
    console.error("[POST /api/member/removal-notices/confirm] DB 오류:", err);
    return apiError("DB_ERROR", "확인 처리 중 오류가 발생했습니다.", 500);
  }
}
