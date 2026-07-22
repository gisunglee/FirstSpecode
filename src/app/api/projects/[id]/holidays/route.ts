/**
 * GET  /api/projects/[id]/holidays — 공휴일 목록 조회 (날짜 오름차순)
 * POST /api/projects/[id]/holidays — 공휴일 수동 추가 (holiday_se_cd = CUSTOM)
 *
 * 설정 > 일정 탭 하위 기능. WBS/업무일지 근무일 계산의 참조 데이터로 프로젝트별 관리.
 * 표준 공휴일(대한민국 법정공휴일)을 한 번에 채워 넣는 기능은 bulk-import 라우트 참고.
 *
 * 권한:
 *   GET  — "content.read" (전 멤버). 근무일 계산에 쓰이는 팀 공유 데이터라 누구나 조회 가능해야 한다.
 *   POST — requireScheduleWrite (schedule.manage: OWNER/ADMIN 역할 또는 PM/PL 직무).
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { requireScheduleWrite } from "@/lib/requireScheduleWrite";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { apiTextLimitGuard } from "@/lib/constants/textLimits";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 공휴일 목록 조회 ────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    const rows = await prisma.tbPjHoliday.findMany({
      where:   { prjct_id: projectId },
      orderBy: { holiday_de: "asc" },
    });

    return apiSuccess({
      items: rows.map((r) => ({
        holidayId:     r.holiday_id,
        name:          r.holiday_nm,
        date:          r.holiday_de.toISOString().slice(0, 10),
        type:          r.holiday_se_cd as "LEGAL" | "CUSTOM",
        creatorMberId: r.creat_mber_id,
        createdAt:     r.creat_dt.toISOString(),
      })),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/holidays] DB 오류:`, err);
    return apiError("DB_ERROR", "공휴일 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 공휴일 수동 추가 ───────────────────────────────────────────────────
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

  const { name, date } = body as { name?: string; date?: string };

  const trimmedName = name?.trim() ?? "";
  if (!trimmedName) {
    return apiError("VALIDATION_ERROR", "공휴일 이름을 입력해 주세요.", 400);
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return apiError("VALIDATION_ERROR", "날짜 형식이 올바르지 않습니다 (YYYY-MM-DD).", 400);
  }

  const limitErr = apiTextLimitGuard([["name", trimmedName]]);
  if (limitErr) return limitErr;

  try {
    const holiday = await prisma.tbPjHoliday.create({
      data: {
        prjct_id:      projectId,
        holiday_nm:    trimmedName,
        holiday_de:    new Date(date + "T00:00:00Z"),
        holiday_se_cd: "CUSTOM",
        creat_mber_id: gate.mberId,
      },
    });

    return apiSuccess({ holidayId: holiday.holiday_id }, 201);
  } catch (err: unknown) {
    // 같은 날짜 중복 등록 — @@unique([prjct_id, holiday_de]) 위반
    const code = (err as { code?: string }).code;
    if (code === "P2002") return apiError("DUPLICATE", "이미 등록된 날짜입니다.", 409);
    console.error(`[POST /api/projects/${projectId}/holidays] DB 오류:`, err);
    return apiError("DB_ERROR", "공휴일 등록에 실패했습니다.", 500);
  }
}
