/**
 * POST /api/projects/[id]/holidays/bulk-import — 표준 공휴일(대한민국) 일괄 등록
 *
 * 프로젝트마다 같은 공휴일 목록(신정·설날·추석 등)을 반복 입력하지 않도록,
 * src/lib/constants/krHolidays.ts 의 고정 참조 데이터를 이 프로젝트의 tb_pj_holiday 로
 * 한 번에 복사한다 — "재사용 서비스"의 핵심.
 *
 * body.years(예: ["2026","2027"])로 등록할 연도를 골라서 넣는다 — 5개년(90여 건) 전체를
 * 한 번에 쏟아부으면 프로젝트 기간과 무관한 연도까지 쌓여 목록이 지저분해지기 때문.
 *
 * 이미 등록된 날짜는 @@unique([prjct_id, holiday_de]) + skipDuplicates 로 건너뛴다.
 * 그래서 버튼을 여러 번 눌러도 중복 생성되지 않는다.
 *
 * 권한: requireScheduleWrite — schedule.manage(OWNER/ADMIN 역할 또는 PM/PL 직무).
 * 일괄 등록은 여러 날짜를 한 번에 만드는 동작이라 "본인 소유" 예외는 적용하지 않는다.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireScheduleWrite } from "@/lib/requireScheduleWrite";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { KR_HOLIDAYS, KR_HOLIDAY_YEARS } from "@/lib/constants/krHolidays";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requireScheduleWrite(request, projectId);
  if (gate instanceof Response) return gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { years } = (body ?? {}) as { years?: unknown };
  if (!Array.isArray(years) || years.length === 0) {
    return apiError("VALIDATION_ERROR", "등록할 연도를 하나 이상 선택해 주세요.", 400);
  }
  const selectedYears = new Set(years.filter((y): y is string => typeof y === "string" && KR_HOLIDAY_YEARS.includes(y)));
  if (selectedYears.size === 0) {
    return apiError("VALIDATION_ERROR", "유효한 연도가 없습니다.", 400);
  }

  const targetHolidays = KR_HOLIDAYS.filter((h) => selectedYears.has(h.date.slice(0, 4)));

  try {
    const result = await prisma.tbPjHoliday.createMany({
      data: targetHolidays.map((h) => ({
        prjct_id:      projectId,
        holiday_nm:    h.name,
        holiday_de:    new Date(h.date + "T00:00:00Z"),
        holiday_se_cd: "LEGAL",
        creat_mber_id: gate.mberId,
      })),
      skipDuplicates: true,
    });

    return apiSuccess({ addedCount: result.count, totalCount: targetHolidays.length });
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/holidays/bulk-import] DB 오류:`, err);
    return apiError("DB_ERROR", "표준 공휴일 일괄 등록에 실패했습니다.", 500);
  }
}
