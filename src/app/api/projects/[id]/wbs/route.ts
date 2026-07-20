/**
 * GET /api/projects/[id]/wbs — WBS 간트 조회 (단위업무/화면/기능)
 *
 * Query:
 *   entity     = UNIT_WORK | SCREEN | FUNCTION (기본 UNIT_WORK)
 *   assignedTo = 멤버 ID ("me" → 로그인 사용자로 치환, 없으면 전체)
 *   status     = wbs-done | wbs-delayed | wbs-in-progress | wbs-not-started (없으면 전체)
 *   startFrom  = YYYY-MM-DD (시작일 이 값 이상만)
 *   startTo    = YYYY-MM-DD (시작일 이 값 이하만)
 *   page       = 1부터 (기본 1)
 *   pageSize   = 20 | 50 | 100 (기본 20)
 *
 * 필터(status/startFrom/startTo)는 filters.ts 에 모아둠 — 새 필터 조건이 생기면
 * 그 파일만 확장하면 되고 이 핸들러는 안 건드려도 된다.
 *
 * 영역(Area)은 날짜 컬럼이 없어 이번 범위에서 제외.
 * 화면은 설계 일정(design_bgng_de/end_de) + 설계 진척률 롤업, 기능은 구현 일정
 * (impl_bgng_de/end_de) + 구현 진척률을 그대로 간트 바에 사용한다.
 *
 * 시작일·종료일이 없는 항목도 목록에서는 빼지 않는다 — 간트 막대는 못 그려도
 * (WbsGanttChart.tsx 에서 start/end 없이 렌더링) 존재 자체는 조회할 수 있어야 한다는
 * 피드백 반영. 그래서 start/end 는 null 일 수 있다.
 */

import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { fetchProjectUnitWorks } from "@/lib/exports/unit-works-data";
import { fetchProjectScreens } from "@/lib/exports/screens-data";
import { fetchProjectFunctions } from "@/lib/exports/functions-data";
import type { DeadlineEntityKind } from "@/types/pm";
import { matchesWbsFilters, parseWbsFilterParams } from "./filters";

type RouteParams = { params: Promise<{ id: string }> };

export type WbsTaskItem = {
  id:         string;
  displayId:  string;
  name:       string;
  start:      string | null;
  end:        string | null;
  progress:   number;
  groupLabel: string;
  href:       string;
  assignee:   string | null;
  effort:     string | null;
};

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

function isEntity(v: string | null): v is DeadlineEntityKind {
  return v === "UNIT_WORK" || v === "SCREEN" || v === "FUNCTION";
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const url = new URL(request.url);
  const entityParam = url.searchParams.get("entity");
  const entity: DeadlineEntityKind = isEntity(entityParam) ? entityParam : "UNIT_WORK";

  const assignedToParam = url.searchParams.get("assignedTo");
  const assigneeFilter = assignedToParam === "me" ? gate.mberId : (assignedToParam || undefined);

  const pageParam     = Number(url.searchParams.get("page"));
  const pageSizeParam = Number(url.searchParams.get("pageSize"));
  const page     = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1;
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(pageSizeParam) ? pageSizeParam : 20;

  const filters = parseWbsFilterParams(url);

  try {
    let items: WbsTaskItem[];

    if (entity === "UNIT_WORK") {
      const rows = await fetchProjectUnitWorks({ projectId, assigneeFilter });
      items = rows.map((r) => ({
        id:         r.unitWorkId,
        displayId:  r.displayId,
        name:       r.name,
        start:      r.startDate ?? null,
        end:        r.endDate ?? null,
        progress:   r.progress,
        groupLabel: r.reqName,
        href:       `/projects/${projectId}/unit-works/${r.unitWorkId}`,
        assignee:   r.assignMemberName,
        effort:     null, // 단위업무는 공수 컬럼 자체가 없음(스키마상 화면/기능에만 있음)
      }));
    } else if (entity === "SCREEN") {
      const rows = await fetchProjectScreens({ projectId, assigneeFilter });
      items = rows.map((r) => ({
        id:         r.screenId,
        displayId:  r.displayId,
        name:       r.name,
        start:      r.startDate ?? null,
        end:        r.endDate ?? null,
        progress:   r.avgDesignRt,
        groupLabel: r.unitWorkName,
        href:       `/projects/${projectId}/screens/${r.screenId}`,
        assignee:   r.assignMemberName,
        effort:     r.designEffort,
      }));
    } else {
      const rows = await fetchProjectFunctions({ projectId, assigneeFilter });
      items = rows.map((r) => ({
        id:         r.funcId,
        displayId:  r.displayId,
        name:       r.name,
        start:      r.startDate ?? null,
        end:        r.endDate ?? null,
        progress:   r.implRt,
        groupLabel: `${r.unitWorkName} / ${r.screenName}`,
        href:       `/projects/${projectId}/functions/${r.funcId}`,
        assignee:   r.assignMemberName,
        effort:     r.effort || null,
      }));
    }

    items = items.filter((item) => matchesWbsFilters(item, filters));

    const totalCount = items.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const pagedItems = items.slice((page - 1) * pageSize, page * pageSize);

    return apiSuccess({ items: pagedItems, page, pageSize, totalCount, totalPages });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/wbs] DB 오류:`, err);
    return apiError("DB_ERROR", "WBS 일정 조회에 실패했습니다.", 500);
  }
}
