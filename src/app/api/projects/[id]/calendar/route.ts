/**
 * GET /api/projects/[id]/calendar?ym=YYYY-MM
 *   — 해당 월의 캘린더 이벤트 통합 조회
 *
 * Query:
 *   ym — YYYY-MM (없으면 현재 월)
 *
 * 권한:
 *   - content.read
 *
 * 2026-07-29 개편 — "단위업무 종료일만" 보여주던 1차 MVP에서, 6종류 이벤트를 한 번에 내려주는
 * 구조로 확장(캘린더 상단 체크박스가 새 쿼리 없이 클라이언트에서 필터만 하도록):
 *   - PHASE: 프로젝트 설정 > 일정 탭의 단계일정(분석/설계/구현/테스트) 시작·종료
 *   - MILESTONE / HOLIDAY: 같은 탭의 마일스톤 / 공휴일
 *   - REQUIREMENT / UNIT_WORK_DESIGN / SCREEN_IMPL: 요구사항 분석·단위업무 계획설계·
 *     화면 실질구현의 시작·종료일 (담당자별로 최대 2개 이벤트 — 시작일이 이 달에 있으면
 *     "시작" 이벤트, 종료일이 이 달에 있으면 "종료" 이벤트, 둘 다 있을 수도 없을 수도 있음)
 *
 * 격리:
 *   - 단위업무 fetch service (lib/exports/unit-works-data.ts) 를 재사용하지 않음.
 *     이유: 그 함수는 진척률·스냅샷 등 무거운 데이터까지 join → 캘린더 셀에는 과함.
 *     캘린더 전용 가벼운 쿼리로 별도 작성.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import type { CalendarEvent, CalendarResponse } from "@/types/calendar";
import { fetchUnitWorkProgress, fetchScreenProgress } from "@/lib/pm/progressRollup";

type RouteParams = { params: Promise<{ id: string }> };

// 카테고리 하나가 한 달에 몰려도 화면 렌더 안정성을 위해 상한.
const MAX_ITEMS_PER_CATEGORY = 500;

// YYYY-MM 문자열 검증
const YM_RE = /^(\d{4})-(\d{2})$/;

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  // ── 조회 월 파싱 ─────────────────────────────────────────────────────
  const url    = new URL(request.url);
  const ymRaw  = url.searchParams.get("ym");

  let year: number;
  let month: number; // 1~12

  if (ymRaw && YM_RE.test(ymRaw)) {
    const [, y, m] = YM_RE.exec(ymRaw)!;
    year  = parseInt(y, 10);
    month = parseInt(m, 10);
    // 비정상 값 방어 — 1900~2999, 1~12
    if (year < 1900 || year > 2999 || month < 1 || month > 12) {
      return apiError("VALIDATION_ERROR", "잘못된 ym 형식입니다. (YYYY-MM)", 400);
    }
  } else {
    // 기본값 — 현재 월 (사용자 로컬 시간 기준이 아닌 서버 시간 기준이지만,
    // KST/UTC 9시간 차이는 월 경계에서만 영향 → 사용자가 직접 ym 지정하면 해결).
    const now = new Date();
    year  = now.getFullYear();
    month = now.getMonth() + 1;
  }

  // 월 시작·끝 ISO 문자열 (YYYY-MM-DD)
  const monthStart = `${year}-${pad2(month)}-01`;
  // 다음 달의 0일 = 이번 달 말일
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${pad2(month)}-${pad2(lastDay)}`;
  // 마일스톤/공휴일은 DateTime 컬럼이라 Date 객체 경계가 필요(문자열 컬럼인 나머지와 다름)
  const monthStartDate = new Date(`${monthStart}T00:00:00Z`);
  const monthEndDate   = new Date(`${monthEnd}T23:59:59Z`);

  try {
    const [project, milestones, holidays, requirements, unitWorks, screens] = await Promise.all([
      prisma.tbPjProject.findUnique({
        where:  { prjct_id: projectId },
        select: {
          anls_bgng_de: true, anls_end_de: true,
          dsgn_bgng_de: true, dsgn_end_de: true,
          dev_bgng_de:  true, dev_end_de:  true,
          test_bgng_de: true, test_end_de: true,
        },
      }),
      prisma.tbPjMilestone.findMany({
        where:  { prjct_id: projectId, milestone_de: { gte: monthStartDate, lte: monthEndDate } },
        select: { milestone_nm: true, milestone_de: true, cn: true },
        take:   MAX_ITEMS_PER_CATEGORY,
      }),
      prisma.tbPjHoliday.findMany({
        where:  { prjct_id: projectId, holiday_de: { gte: monthStartDate, lte: monthEndDate } },
        select: { holiday_nm: true, holiday_de: true },
        take:   MAX_ITEMS_PER_CATEGORY,
      }),
      prisma.tbRqRequirement.findMany({
        where: {
          prjct_id: projectId,
          OR: [
            { anls_bgng_de: { gte: monthStart, lte: monthEnd } },
            { anls_end_de:  { gte: monthStart, lte: monthEnd } },
          ],
        },
        select: {
          req_id: true, req_display_id: true, req_nm: true,
          anls_bgng_de: true, anls_end_de: true, progrs_rt: true, asign_mber_id: true,
        },
        take: MAX_ITEMS_PER_CATEGORY,
      }),
      prisma.tbDsUnitWork.findMany({
        where: {
          prjct_id: projectId,
          OR: [
            { plan_dsgn_bgng_de: { gte: monthStart, lte: monthEnd } },
            { plan_dsgn_end_de:  { gte: monthStart, lte: monthEnd } },
          ],
        },
        select: {
          unit_work_id: true, unit_work_display_id: true, unit_work_nm: true,
          plan_dsgn_bgng_de: true, plan_dsgn_end_de: true, asign_mber_id: true,
        },
        take: MAX_ITEMS_PER_CATEGORY,
      }),
      prisma.tbDsScreen.findMany({
        where: {
          prjct_id: projectId,
          OR: [
            { actl_impl_bgng_de: { gte: monthStart, lte: monthEnd } },
            { actl_impl_end_de:  { gte: monthStart, lte: monthEnd } },
          ],
        },
        select: {
          scrn_id: true, scrn_display_id: true, scrn_nm: true,
          actl_impl_bgng_de: true, actl_impl_end_de: true, asign_mber_id: true,
        },
        take: MAX_ITEMS_PER_CATEGORY,
      }),
    ]);

    // 진행률은 저장값이 아니라 하위 기능 롤업 계산값(2026-07-28) — 단위업무는 설계%, 화면은 구현%만 필요
    const [uwProgressMap, scrProgressMap] = await Promise.all([
      fetchUnitWorkProgress(unitWorks.map((u) => u.unit_work_id)),
      fetchScreenProgress(screens.map((s) => s.scrn_id)),
    ]);

    const events: CalendarEvent[] = [
      ...buildPhaseEvents(project, monthStart, monthEnd),
      ...milestones.map((m): CalendarEvent => ({
        category: "MILESTONE", date: toDateStr(m.milestone_de), label: m.milestone_nm,
        href: null, progress: null, isMine: null, content: m.cn ?? "",
      })),
      ...holidays.map((h): CalendarEvent => ({
        category: "HOLIDAY", date: toDateStr(h.holiday_de), label: h.holiday_nm,
        href: null, progress: null, isMine: null, content: null,
      })),
      ...requirements.flatMap((r) => buildStartEndEvents({
        category: "REQUIREMENT", displayId: r.req_display_id, name: r.req_nm,
        startDate: r.anls_bgng_de, endDate: r.anls_end_de,
        href: `/projects/${projectId}/requirements/${r.req_id}`,
        progress: r.progrs_rt, isMine: r.asign_mber_id === gate.mberId,
        monthStart, monthEnd,
      })),
      ...unitWorks.flatMap((u) => buildStartEndEvents({
        category: "UNIT_WORK_DESIGN", displayId: u.unit_work_display_id, name: u.unit_work_nm,
        startDate: u.plan_dsgn_bgng_de, endDate: u.plan_dsgn_end_de,
        href: `/projects/${projectId}/unit-works/${u.unit_work_id}`,
        progress: uwProgressMap.get(u.unit_work_id)?.designRt ?? 0, isMine: u.asign_mber_id === gate.mberId,
        monthStart, monthEnd,
      })),
      ...screens.flatMap((s) => buildStartEndEvents({
        category: "SCREEN_IMPL", displayId: s.scrn_display_id, name: s.scrn_nm,
        startDate: s.actl_impl_bgng_de, endDate: s.actl_impl_end_de,
        href: `/projects/${projectId}/screens/${s.scrn_id}`,
        progress: scrProgressMap.get(s.scrn_id)?.implRt ?? 0, isMine: s.asign_mber_id === gate.mberId,
        monthStart, monthEnd,
      })),
    ];

    const response: CalendarResponse = { monthStart, monthEnd, events };

    return apiSuccess(response);
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/calendar] DB 오류:`, err);
    return apiError("DB_ERROR", "캘린더 데이터 조회에 실패했습니다.", 500);
  }
}

function pad2(n: number): string { return String(n).padStart(2, "0"); }

function toDateStr(d: Date): string { return d.toISOString().slice(0, 10); }

// 단계일정 — 프로젝트 전역 8컬럼(분석/설계/구현/테스트 × 시작/종료) 중 이 달에 걸리는 것만
// 이벤트로. "시작"·"종료"는 각각 독립적으로 이 달에 있을 때만 뽑는다(둘 다일 수도, 하나만일 수도).
function buildPhaseEvents(
  project: {
    anls_bgng_de: Date | null; anls_end_de: Date | null;
    dsgn_bgng_de: Date | null; dsgn_end_de: Date | null;
    dev_bgng_de:  Date | null; dev_end_de:  Date | null;
    test_bgng_de: Date | null; test_end_de: Date | null;
  } | null,
  monthStart: string,
  monthEnd: string
): CalendarEvent[] {
  if (!project) return [];
  const phases: { label: string; bgng: Date | null; end: Date | null }[] = [
    { label: "분석",   bgng: project.anls_bgng_de, end: project.anls_end_de },
    { label: "설계",   bgng: project.dsgn_bgng_de, end: project.dsgn_end_de },
    { label: "구현",   bgng: project.dev_bgng_de,  end: project.dev_end_de },
    { label: "테스트", bgng: project.test_bgng_de, end: project.test_end_de },
  ];
  const events: CalendarEvent[] = [];
  for (const { label, bgng, end } of phases) {
    if (bgng) {
      const s = toDateStr(bgng);
      if (s >= monthStart && s <= monthEnd) {
        events.push({ category: "PHASE", date: s, label: `${label} 시작`, href: null, progress: null, isMine: null, content: null });
      }
    }
    if (end) {
      const s = toDateStr(end);
      if (s >= monthStart && s <= monthEnd) {
        events.push({ category: "PHASE", date: s, label: `${label} 종료`, href: null, progress: null, isMine: null, content: null });
      }
    }
  }
  return events;
}

// 요구사항/단위업무 설계/화면 구현 공용 — 시작일이 이 달에 있으면 "시작" 이벤트,
// 종료일이 이 달에 있으면 "종료" 이벤트(둘 다 있을 수도, 하나만 있을 수도, DB 조회에서
// 이미 둘 중 하나는 이 달 범위에 걸린다는 게 보장돼 있지만 개별 필드는 각각 다시 확인).
function buildStartEndEvents(args: {
  category: CalendarEvent["category"];
  displayId: string;
  name: string;
  startDate: string | null;
  endDate:   string | null;
  href: string;
  progress: number;
  isMine: boolean;
  monthStart: string;
  monthEnd: string;
}): CalendarEvent[] {
  const { category, displayId, name, startDate, endDate, href, progress, isMine, monthStart, monthEnd } = args;
  const events: CalendarEvent[] = [];
  if (startDate && startDate >= monthStart && startDate <= monthEnd) {
    events.push({ category, date: startDate, label: `${displayId} ${name} 시작`, href, progress, isMine, content: null });
  }
  if (endDate && endDate >= monthStart && endDate <= monthEnd) {
    events.push({ category, date: endDate, label: `${displayId} ${name} 종료`, href, progress, isMine, content: null });
  }
  return events;
}
