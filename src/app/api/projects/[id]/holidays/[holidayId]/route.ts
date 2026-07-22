/**
 * DELETE /api/projects/[id]/holidays/[holidayId] — 공휴일 삭제
 *
 * 수정 기능은 없음(설정 > 일정 탭) — 잘못 등록한 날짜는 삭제 후 다시 등록한다.
 * 권한: requireScheduleWrite — schedule.manage(OWNER/ADMIN 역할 또는 PM/PL 직무)
 * 통과 못 해도 본인이 등록한 항목이면 허용(요구사항 담당자 예외와 동일 관례).
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireScheduleWrite } from "@/lib/requireScheduleWrite";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; holidayId: string }> };

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, holidayId } = await params;
  const gate = await requireScheduleWrite(request, projectId, async () => {
    const existing = await prisma.tbPjHoliday.findFirst({
      where:  { holiday_id: holidayId, prjct_id: projectId },
      select: { creat_mber_id: true },
    });
    return existing?.creat_mber_id ?? null;
  });
  if (gate instanceof Response) return gate;

  try {
    const existing = await prisma.tbPjHoliday.findFirst({
      where:  { holiday_id: holidayId, prjct_id: projectId },
      select: { holiday_id: true },
    });
    if (!existing) return apiError("NOT_FOUND", "공휴일을 찾을 수 없습니다.", 404);

    await prisma.tbPjHoliday.delete({ where: { holiday_id: holidayId } });

    return apiSuccess({ holidayId, deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/holidays/${holidayId}] DB 오류:`, err);
    return apiError("DB_ERROR", "공휴일 삭제에 실패했습니다.", 500);
  }
}
