/**
 * GET /api/member/removal-notices — 제거 안내 이력 조회 (FID-00090)
 *
 * 역할:
 *   - 로그인 직후 미확인 제거 안내 이력 반환
 *   - cnfrm_yn = 'N'인 건만 조회
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const notices = await prisma.tbPjMemberRemovalNotice.findMany({
      where: {
        mber_id:  auth.mberId,
        cnfrm_yn: "N",
      },
      orderBy: { creat_dt: "desc" },
    });

    return apiSuccess({
      notices: notices.map((n) => ({
        noticeId:    n.notice_id,
        projectName: n.prjct_nm,
        removedAt:   n.creat_dt,
      })),
    });
  } catch (err) {
    console.error("[GET /api/member/removal-notices] DB 오류:", err);
    return apiError("DB_ERROR", "제거 안내 조회에 실패했습니다.", 500);
  }
}
