/**
 * GET /api/projects/[id]/wbs — WBS 간트 조회 (단위업무/화면/기능)
 *
 * Query:
 *   entity     = UNIT_WORK | SCREEN | FUNCTION (기본 UNIT_WORK)
 *   phase      = DESIGN | IMPL (기본 IMPL) — 진척률을 기능의 design_rt/impl_rt 중 무엇으로
 *                롤업할지 선택. 단위업무는 자체 계획설계값(plan_dsgn_*)을 WBS에서 전혀
 *                쓰지 않고 항상 화면·기능 실측값을 롤업한다 — unitWorkPhaseRollup.ts 참고.
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
 *
 * phase별 기간(날짜) 축 — 엔티티마다 해당 phase의 날짜 컬럼이 없으면 롤업/상속한다:
 *   - UNIT_WORK: DESIGN=하위 화면 실질설계 일정 MIN~MAX, IMPL=하위 화면 실질구현 일정 MIN~MAX
 *   - SCREEN   : DESIGN=화면 자신의 actl_dsgn_*, IMPL=화면 자신의 actl_impl_*
 *   - FUNCTION : DESIGN=부모 화면의 actl_dsgn_* 상속, IMPL=부모 화면의 actl_impl_* 상속
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
import { fetchUnitWorkPhaseRollup } from "./unitWorkPhaseRollup";
import type { DeadlineEntityKind, ProgressKind } from "@/types/pm";
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

function isPhase(v: string | null): v is ProgressKind {
  return v === "DESIGN" || v === "IMPL";
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const url = new URL(request.url);
  const entityParam = url.searchParams.get("entity");
  const entity: DeadlineEntityKind = isEntity(entityParam) ? entityParam : "UNIT_WORK";

  const phaseParam = url.searchParams.get("phase");
  const phase: ProgressKind = isPhase(phaseParam) ? phaseParam : "IMPL";

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
      // 단위업무 자신의 plan_dsgn_*(PM이 잡는 계획치)는 하위 화면·기능의 실제 진행 상황과
      // 무관하게 따로 관리되는 값이라 WBS에서는 아예 안 쓴다 — identity(이름·담당자·
      // 요구사항명)만 fetchProjectUnitWorks에서 가져오고, 기간·진척률은 항상 화면·기능
      // 실측값을 롤업한 unitWorkPhaseRollup으로 대체한다.
      const rows = await fetchProjectUnitWorks({ projectId, assigneeFilter });
      const rollup = await fetchUnitWorkPhaseRollup(rows.map((r) => r.unitWorkId), phase);
      items = rows.map((r) => {
        const roll = rollup.get(r.unitWorkId);
        return {
          id:         r.unitWorkId,
          displayId:  r.displayId,
          name:       r.name,
          start:      roll?.start ?? null,
          end:        roll?.end ?? null,
          progress:   roll?.progress ?? 0,
          groupLabel: r.reqName,
          href:       `/projects/${projectId}/unit-works/${r.unitWorkId}`,
          assignee:   r.assignMemberName,
          effort:     null, // 단위업무는 공수 컬럼 자체가 없음(스키마상 화면/기능에만 있음)
        };
      });
    } else if (entity === "SCREEN") {
      const rows = await fetchProjectScreens({ projectId, assigneeFilter });
      items = rows.map((r) => ({
        id:         r.screenId,
        displayId:  r.displayId,
        name:       r.name,
        // 설계phase: 화면 자신의 실질설계 일정. 구현phase: 화면 자신의 실질구현 일정
        // (2026-07-28부터 화면이 직접 가짐 — 더 이상 기능에서 롤업하지 않음).
        start:      phase === "DESIGN" ? (r.startDate ?? null) : (r.implStartDate ?? null),
        end:        phase === "DESIGN" ? (r.endDate ?? null)   : (r.implEndDate ?? null),
        progress:   phase === "DESIGN" ? r.avgDesignRt : r.avgImplRt,
        groupLabel: r.unitWorkName,
        href:       `/projects/${projectId}/screens/${r.screenId}`,
        assignee:   r.assignMemberName,
        // 구현phase엔 화면 자체 구현 공수 컬럼이 없어 빈칸 처리(하위 기능 공수 억지 합산 안 함)
        effort:     phase === "DESIGN" ? r.designEffort : null,
      }));
    } else {
      const rows = await fetchProjectFunctions({ projectId, assigneeFilter });
      items = rows.map((r) => ({
        id:         r.funcId,
        displayId:  r.displayId,
        name:       r.name,
        // 설계phase: 기능 자신은 설계 일정 컬럼이 없어 부모 화면의 설계 일정을 그대로
        // 상속해서 보여준다(진척률만 기능 자신의 design_rt). 구현phase: 기존과 동일.
        start:      phase === "DESIGN" ? (r.screenDesignStartDate ?? null) : (r.startDate ?? null),
        end:        phase === "DESIGN" ? (r.screenDesignEndDate ?? null)   : (r.endDate ?? null),
        progress:   phase === "DESIGN" ? r.designRt : r.implRt,
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
