/**
 * GET /api/admin/support-session/stale — 지원 세션 통계 (시스템 관리자 전용)
 *
 * 반환:
 *   - total:    전체 세션 누적 개수
 *   - active:   현재 진행 중 (expires_dt > now AND ended_dt IS NULL)
 *   - stale:    만료되었지만 종료 처리되지 않은 것 (expires_dt < now AND ended_dt IS NULL)
 *              → "정리 버튼" 의 대상
 *   - ended:    정상 종료된 것 (ended_dt IS NOT NULL)
 *
 * 사용처:
 *   /admin 대시보드 하단 "만료 세션 정리" 카드 — stale 건수를 표시하고
 *   "정리하기" 버튼으로 POST /api/admin/support-session/cleanup 호출.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";

export async function GET(request: NextRequest) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const now = new Date();

  try {
    // 4개 카운트를 병렬로 한 번에 — 페이지 부하를 줄인다
    const [total, active, stale, ended] = await Promise.all([
      prisma.tbSysAdminSupportSession.count(),
      prisma.tbSysAdminSupportSession.count({
        where: { ended_dt: null, expires_dt: { gt: now } },
      }),
      prisma.tbSysAdminSupportSession.count({
        where: { ended_dt: null, expires_dt: { lte: now } },
      }),
      prisma.tbSysAdminSupportSession.count({
        where: { ended_dt: { not: null } },
      }),
    ]);

    return apiSuccess({ total, active, stale, ended });
  } catch (err) {
    console.error("[GET /api/admin/support-session/stale] DB 오류:", err);
    return apiError("DB_ERROR", "통계 조회에 실패했습니다.", 500);
  }
}
