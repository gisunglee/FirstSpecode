/**
 * GET /api/projects/[id]/wbs — WBS 간트 조회 (단위업무/화면)
 *
 * Query:
 *   entity     = UNIT_WORK | SCREEN (기본 UNIT_WORK) — 기능 탭은 2026-07-29 삭제됨
 *                (화면 탭이 하위 기능의 구현 일정/진척률을 이미 롤업해서 보여주고 있어
 *                기능 단위로 따로 조회하는 게 중복이라는 피드백)
 *   phase      = DESIGN | IMPL (기본 IMPL) — 진척률을 기능의 design_rt/impl_rt 중 무엇으로
 *                롤업할지 선택. 진척률은 항상 화면·기능 실측값을 롤업하지만(단위업무 자체엔
 *                진척률 컬럼이 없음), 설계 "일정"만은 2026-07-28 2차 개편으로 단위업무 자신의
 *                plan_dsgn_*를 그대로 씀(화면이 많으면 화면별 설계 일정 입력이 부담이라 —
 *                구현 일정은 여전히 화면 기준) — unitWorkPhaseRollup.ts 참고.
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
 *   - UNIT_WORK: DESIGN=단위업무 자신의 plan_dsgn_*(롤업 아님, 직접 값), IMPL=하위 화면 실질구현 일정 MIN~MAX
 *   - SCREEN   : DESIGN=소속 단위업무의 plan_dsgn_* 상속, IMPL=화면 자신의 actl_impl_*
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
import { fetchUnitWorkPhaseRollup } from "./unitWorkPhaseRollup";
import type { ProgressKind } from "@/types/pm";
import { matchesWbsFilters, parseWbsFilterParams } from "./filters";

type RouteParams = { params: Promise<{ id: string }> };

// 화면(client)의 WbsEntityKind(wbsFilterOptions.ts)와 값 집합이 같아야 하지만, app/api는
// app/(main) 트리를 import하지 않는다는 원칙(서버/클라이언트 분리)을 지키기 위해 여기서
// 똑같이 한 번 더 선언한다 — 값이 어긋나면 이 두 곳을 나란히 봐야 함.
type WbsEntityKind = "UNIT_WORK" | "SCREEN";

export type WbsTaskItem = {
  id:         string;
  displayId:  string;
  name:       string;
  start:      string | null;
  end:        string | null;
  progress:   number;
  /**
   * 그룹으로 보기 시 상위 그룹 정보(1단) — 단위업무 탭=요구사항, 화면 탭=소속 단위업무.
   * wbsTasks.ts buildGroupedTasks가 이 값으로 요약(summary) 부모 행을 만든다. 배열로 둔 건
   * 기능 탭이 있던 시절 [단위업무, 화면] 2단 중첩을 표현하던 흔적인데, 기능 탭 삭제(2026-07-29)
   * 이후로는 항상 길이 1이다 — 나중에 다단 그룹이 다시 필요해지면 그때 늘리면 된다.
   *
   * displayId/assignee — 요약 행이 그 조상 엔티티(요구사항/단위업무) 자신의 ID·담당자를
   * "-"로 비워두지 않고 그대로 보여주기 위함("어차피 있는 값인데 왜 안 보여주냐"는 피드백).
   * 여러 자식의 값을 합쳐야 하는 기간/진척률과 달리, 이 값들은 그룹 자체가 곧 그 엔티티 하나라
   * 합산 없이 그대로 쓰면 된다.
   */
  groupPath:  { label: string; displayId: string | null; assignee: string | null }[];
  href:       string;
  assignee:   string | null;
  effort:     string | null;
};

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

function isEntity(v: string | null): v is WbsEntityKind {
  return v === "UNIT_WORK" || v === "SCREEN";
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
  const entity: WbsEntityKind = isEntity(entityParam) ? entityParam : "UNIT_WORK";

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
          groupPath:  [{ label: r.reqName, displayId: r.reqDisplayId, assignee: r.reqAssignMemberName }],
          href:       `/projects/${projectId}/unit-works/${r.unitWorkId}`,
          assignee:   r.assignMemberName,
          // 설계phase: 단위업무 자신의 계획설계공수(plan_dsgn_efrt_val). 구현phase: 단위업무
          // 자신은 구현 공수 컬럼이 없어(스키마상 기능 소관) 하위 기능 전체 합으로 대신 보여준다.
          effort:     phase === "DESIGN" ? r.designEffort : (r.implEffortHours > 0 ? String(r.implEffortHours) : null),
        };
      });
    } else {
      const rows = await fetchProjectScreens({ projectId, assigneeFilter });
      items = rows.map((r) => ({
        id:         r.screenId,
        displayId:  r.displayId,
        name:       r.name,
        // 설계phase: 화면 자신은 설계 일정이 없어(2026-07-28 2차 개편) 소속 단위업무의
        // 계획설계기간을 그대로 상속해서 보여준다. 구현phase: 화면 자신의 실질구현 일정.
        start:      phase === "DESIGN" ? (r.startDate ?? null) : (r.implStartDate ?? null),
        end:        phase === "DESIGN" ? (r.endDate ?? null)   : (r.implEndDate ?? null),
        progress:   phase === "DESIGN" ? r.avgDesignRt : r.avgImplRt,
        groupPath:  [{ label: r.unitWorkName, displayId: r.unitWorkDisplayId, assignee: r.unitWorkAssignMemberName }],
        href:       `/projects/${projectId}/screens/${r.screenId}`,
        assignee:   r.assignMemberName,
        // 설계phase: 화면 단위로 쪼갤 수 없는 값(설계공수는 단위업무 전체 하나뿐)이라 빈칸.
        // 구현phase: 화면 자신은 구현 공수 컬럼이 없어(스키마상 기능 소관) 하위 기능 합으로 대신 보여준다.
        effort:     phase === "DESIGN" ? null : (r.implEffortHours > 0 ? String(r.implEffortHours) : null),
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
