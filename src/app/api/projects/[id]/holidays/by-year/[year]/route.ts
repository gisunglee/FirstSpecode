/**
 * DELETE /api/projects/[id]/holidays/by-year/[year] — 특정 연도 공휴일 전체 삭제
 *
 * 설정 > 일정 탭의 연도별 아코디언에서 "이 연도 전체 삭제" 버튼이 호출한다.
 * 일괄 등록을 잘못된 연도로 눌렀을 때 하나씩 지우지 않고 한 번에 되돌리기 위한 기능.
 *
 * 권한: requireScheduleWrite — schedule.manage(OWNER/ADMIN 역할 또는 PM/PL 직무).
 * 연도 전체 삭제는 여러 사람이 등록한 항목을 한 번에 지울 수 있어 "본인 소유"
 * 예외는 적용하지 않는다(단건 삭제와 다른 점).
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireScheduleWrite } from "@/lib/requireScheduleWrite";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; year: string }> };

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, year } = await params;
  const gate = await requireScheduleWrite(request, projectId);
  if (gate instanceof Response) return gate;

  if (!/^\d{4}$/.test(year)) {
    return apiError("VALIDATION_ERROR", "연도 형식이 올바르지 않습니다 (YYYY).", 400);
  }

  const yearStart = new Date(`${year}-01-01T00:00:00Z`);
  const yearEnd   = new Date(`${Number(year) + 1}-01-01T00:00:00Z`);

  try {
    const result = await prisma.tbPjHoliday.deleteMany({
      where: { prjct_id: projectId, holiday_de: { gte: yearStart, lt: yearEnd } },
    });

    return apiSuccess({ deletedCount: result.count });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/holidays/by-year/${year}] DB 오류:`, err);
    return apiError("DB_ERROR", "연도별 공휴일 삭제에 실패했습니다.", 500);
  }
}
