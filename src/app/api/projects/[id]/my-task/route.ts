/**
 * GET /api/projects/[id]/my-task — "My Task" 페이지 통합 데이터
 *
 * 역할:
 *   - 단위업무/화면/영역/기능(요구사항 제외)을 프로젝트 전체 기준으로 조회.
 *   - view=flat: 단위업무/화면/기능만 평탄화한 한 줄 목록(영역 제외) — assigneeId로 필터 가능.
 *   - view=tree: 단위업무→화면→영역→기능 전체 구조 트리. assigneeId를 넘기면 그 사람 담당이거나
 *     그 사람 담당인 하위 항목을 품고 있는 노드만 남기고 나머지는 가지째 잘라낸다(연결 통로로만
 *     쓰이는 조상 노드는 남김) — 무관한 사람 항목이 섞여 나오면 안 된다는 피드백으로 목록과
 *     동일하게 실제로 걸러지도록 함.
 *   - sortBy=deadline: dDay 오름차순(마감 없으면 맨 뒤). flat은 전체를 한 줄로 섞어서 정렬,
 *     tree는 각 부모 밑 형제 노드끼리만 재정렬(구조는 유지).
 *   - sortBy=sortOrder: 원래 배치 순서(sort_ordr) 그대로 — flat도 트리를 전위순회(pre-order)한
 *     순서라 부모 밑 자식이 뭉쳐서 나온다.
 *
 * Query: assigneeId? · view?("flat"|"tree", 기본 flat) · sortBy?("deadline"|"sortOrder", 기본 deadline)
 *        page?(기본 1) · pageSize?(20|50|100, 기본 20)
 *   - flat: 정렬된 행 배열을 그대로 페이징.
 *   - tree: 최상위 노드(단위업무 + 소속 없는 기능) 기준으로 페이징 — 한 단위업무의 하위 트리가
 *     페이지 중간에 잘리면 구조를 알아보기 어려워서, 자르는 단위를 항상 최상위로 둔다.
 *
 * 권한: content.read (VIEWER 이상)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { fetchProjectMembers } from "@/lib/exports/members-data";
import { fetchDeadlineItems } from "@/lib/pm/fetchDeadlineItems";
import { computeDDay } from "@/lib/pm/deadlineProgress";
import { parseEffortHours } from "@/lib/effort";
import type { MyTaskNode, MyTaskResponse, MyTaskView, MyTaskSortBy } from "@/types/myTask";

type RouteParams = { params: Promise<{ id: string }> };

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// dDay 오름차순, 마감 없으면 맨 뒤 — 이름 오름차순으로 동률 처리
function byDeadline(a: MyTaskNode, b: MyTaskNode): number {
  if (a.dDay === null && b.dDay === null) return a.name.localeCompare(b.name);
  if (a.dDay === null) return 1;
  if (b.dDay === null) return -1;
  if (a.dDay !== b.dDay) return a.dDay - b.dDay;
  return a.name.localeCompare(b.name);
}

// 트리의 각 레벨(형제 노드)을 sortBy 기준으로 재정렬 — 구조(부모-자식)는 그대로 유지
function sortTree(nodes: MyTaskNode[], sortBy: MyTaskSortBy): MyTaskNode[] {
  const sorted = sortBy === "deadline" ? [...nodes].sort(byDeadline) : nodes;
  return sorted.map((n) => ({ ...n, children: sortTree(n.children, sortBy) }));
}

// 노드 자신이 담당자거나(assigneeId 일치) 하위 어딘가에 그 담당자 항목이 있으면 남기고,
// 그 외(자신도 아니고 하위에도 없음)엔 가지째 제거 — 영역처럼 담당자 개념이 없는 노드는
// 하위에 살아남은 자식이 있을 때만 "연결 통로"로 남는다.
function pruneToAssignee(nodes: MyTaskNode[], assigneeId: string): MyTaskNode[] {
  const out: MyTaskNode[] = [];
  for (const n of nodes) {
    const prunedChildren = pruneToAssignee(n.children, assigneeId);
    if (n.assigneeId === assigneeId || prunedChildren.length > 0) {
      out.push({ ...n, children: prunedChildren });
    }
  }
  return out;
}

// 트리를 전위순회로 평탄화하면서 영역(AREA)은 제외 — flat 모드는 "실제 작업 단위"만 다룸
function flattenSkipArea(nodes: MyTaskNode[]): MyTaskNode[] {
  const out: MyTaskNode[] = [];
  for (const n of nodes) {
    if (n.kind !== "AREA") out.push({ ...n, children: [] });
    out.push(...flattenSkipArea(n.children));
  }
  return out;
}

// 단위업무의 구현 일정 롤업 — 하위 화면들의 실질구현기간 중 가장 이른 시작일/가장 늦은
// 종료일. 하나도 없으면 null(비워둠). "YYYY-MM-DD" 문자열이라 사전식 비교 = 날짜 비교.
function rollupDateRange(dates: { start: string | null; end: string | null }[]): { start: string | null; end: string | null } {
  const starts = dates.map((d) => d.start).filter((s): s is string => !!s);
  const ends = dates.map((d) => d.end).filter((e): e is string => !!e);
  return {
    start: starts.length > 0 ? starts.reduce((min, s) => (s < min ? s : min)) : null,
    end:   ends.length   > 0 ? ends.reduce((max, e) => (e > max ? e : max)) : null,
  };
}

// 구현 공수 롤업 — 하위 기능들의 공수(시간)를 합산. 값이 있는 기능이 하나도 없으면
// null(0으로 채우면 "공수 0으로 확정"과 "아직 아무도 안 입력"이 구분 안 됨).
function sumEffortHours(vals: (string | null)[]): string | null {
  const withValue = vals.filter((v) => v && v.trim());
  if (withValue.length === 0) return null;
  const total = withValue.reduce((sum, v) => sum + parseEffortHours(v), 0);
  return String(total);
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const url = new URL(request.url);
  const assigneeIdParam = url.searchParams.get("assigneeId");
  const viewParam       = url.searchParams.get("view");
  const sortByParam     = url.searchParams.get("sortBy");
  const pageParam       = Number(url.searchParams.get("page"));
  const pageSizeParam   = Number(url.searchParams.get("pageSize"));

  const view:   MyTaskView   = viewParam === "tree" ? "tree" : "flat";
  const sortBy: MyTaskSortBy = sortByParam === "sortOrder" ? "sortOrder" : "deadline";
  const assigneeId = assigneeIdParam?.trim() || null;
  const page = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1;
  const pageSize = ([20, 50, 100] as const).includes(pageSizeParam as 20 | 50 | 100) ? pageSizeParam : 20;

  const today = todayStr();

  try {
    const [unitWorks, orphanFunctions, members, uwImplRows, uwDesignRows, scrImplRows, scrDesignRows, fnImplRows, fnDesignRows] = await Promise.all([
      prisma.tbDsUnitWork.findMany({
        where:   { prjct_id: projectId },
        orderBy: { sort_ordr: "asc" },
        include: {
          screens: {
            orderBy: { sort_ordr: "asc" },
            include: {
              areas: {
                orderBy: { sort_ordr: "asc" },
                include: { functions: { orderBy: { sort_ordr: "asc" } } },
              },
            },
          },
        },
      }),
      // 영역이 아예 없거나(영역 자체가 화면에 안 붙은) 기능 — 단위업무→화면→영역 경로로는
      // 절대 안 잡힌다. "전체 점검"이 이 화면의 존재 이유라 이런 것도 빠뜨리면 안 됨 —
      // 트리 최상위에 별도 노드로 얹고, flat은 같은 배열을 훑으니 자동으로 포함된다.
      prisma.tbDsFunction.findMany({
        where:   { prjct_id: projectId, OR: [{ area_id: null }, { area: { scrn_id: null } }] },
        orderBy: { sort_ordr: "asc" },
      }),
      fetchProjectMembers({ projectId }),
      // 설계/구현 진척률 — "진척률은 기능걸로 통일" 원칙(fetchDeadlineItems.ts, my-work/route.ts와
      // 동일 관례). 단위업무·화면은 하위 기능 롤업, 기능은 자기 자신의 값. 담당자 필터 없이 전체 조회.
      fetchDeadlineItems(projectId, "UNIT_WORK", "IMPL"),
      fetchDeadlineItems(projectId, "UNIT_WORK", "DESIGN"),
      fetchDeadlineItems(projectId, "SCREEN", "IMPL"),
      fetchDeadlineItems(projectId, "SCREEN", "DESIGN"),
      fetchDeadlineItems(projectId, "FUNCTION", "IMPL"),
      fetchDeadlineItems(projectId, "FUNCTION", "DESIGN"),
    ]);

    const nameMap = new Map(members.map((m) => [m.memberId, m.name || m.email]));
    const toMap = (rows: { id: string; progress: number }[]) => new Map(rows.map((r) => [r.id, r.progress]));
    const uwImpl = toMap(uwImplRows), uwDesign = toMap(uwDesignRows);
    const scrImpl = toMap(scrImplRows), scrDesign = toMap(scrDesignRows);
    const fnImpl = toMap(fnImplRows), fnDesign = toMap(fnDesignRows);

    // 기능 자신은 구현 일정이 없음 — 소속 화면의 실질구현기간을 그대로 상속(2026-07-28).
    // 화면이 없는(orphan) 기능은 상속할 데가 없어 null 그대로. 설계 일정/공수는 애초에
    // 단위업무 소관이라 기능은 관여하지 않음 — 항상 null.
    function toFunctionNode(
      fn: (typeof orphanFunctions)[number],
      screenImplDates?: { start: string | null; end: string | null },
    ): MyTaskNode {
      const implStartDate = screenImplDates?.start ?? null;
      const implEndDate   = screenImplDates?.end   ?? null;
      return {
        kind: "FUNCTION", id: fn.func_id, displayId: fn.func_display_id, name: fn.func_nm,
        href: `/projects/${projectId}/functions/${fn.func_id}`,
        assigneeId: fn.asign_mber_id, assigneeName: fn.asign_mber_id ? (nameMap.get(fn.asign_mber_id) ?? null) : null,
        docStatus: fn.dsgn_doc_sttus_code,
        designStartDate: null, designEndDate: null, designEffort: null,
        implStartDate, implEndDate, implEffort: fn.impl_efrt_val,
        designProgress: fnDesign.get(fn.func_id) ?? 0, implProgress: fnImpl.get(fn.func_id) ?? 0,
        dDay: implEndDate ? computeDDay(implEndDate, today) : null,
        sortOrder: fn.sort_ordr,
        children: [],
      };
    }

    const tree: MyTaskNode[] = unitWorks.map((uw) => {
      const uwFunctions = uw.screens.flatMap((scr) => scr.areas.flatMap((ar) => ar.functions));
      // 단위업무는 구현 일정/공수 자체가 없는 필드 — 하위 화면(일정)·기능(공수) 롤업으로 채운다.
      const uwImplDates = rollupDateRange(uw.screens.map((scr) => ({ start: scr.actl_impl_bgng_de, end: scr.actl_impl_end_de })));
      const uwImplEffort = sumEffortHours(uwFunctions.map((fn) => fn.impl_efrt_val));

      return {
        kind: "UNIT_WORK", id: uw.unit_work_id, displayId: uw.unit_work_display_id, name: uw.unit_work_nm,
        href: `/projects/${projectId}/unit-works/${uw.unit_work_id}`,
        assigneeId: uw.asign_mber_id, assigneeName: uw.asign_mber_id ? (nameMap.get(uw.asign_mber_id) ?? null) : null,
        docStatus: uw.dsgn_doc_sttus_code,
        // 계획설계기간/공수 — PM이 잡는 상위 마일스톤(목표치), 진척과 무관. 단위업무 직접 소유.
        designStartDate: uw.plan_dsgn_bgng_de, designEndDate: uw.plan_dsgn_end_de, designEffort: uw.plan_dsgn_efrt_val,
        implStartDate: uwImplDates.start, implEndDate: uwImplDates.end, implEffort: uwImplEffort,
        designProgress: uwDesign.get(uw.unit_work_id) ?? 0, implProgress: uwImpl.get(uw.unit_work_id) ?? 0,
        dDay: uw.plan_dsgn_end_de ? computeDDay(uw.plan_dsgn_end_de, today) : null,
        sortOrder: uw.sort_ordr,
        children: uw.screens.map((scr) => {
          const scrFunctions = scr.areas.flatMap((ar) => ar.functions);
          return {
            kind: "SCREEN", id: scr.scrn_id, displayId: scr.scrn_display_id, name: scr.scrn_nm,
            href: `/projects/${projectId}/screens/${scr.scrn_id}`,
            assigneeId: scr.asign_mber_id, assigneeName: scr.asign_mber_id ? (nameMap.get(scr.asign_mber_id) ?? null) : null,
            docStatus: scr.dsgn_doc_sttus_code,
            // 화면 자신은 설계 일정/공수가 없음(2026-07-28부터 단위업무 소관) — 비워둔다.
            designStartDate: null, designEndDate: null, designEffort: null,
            // 구현 일정은 화면이 직접 소유, 구현 공수는 하위 기능들의 합산 롤업.
            implStartDate: scr.actl_impl_bgng_de, implEndDate: scr.actl_impl_end_de,
            implEffort: sumEffortHours(scrFunctions.map((fn) => fn.impl_efrt_val)),
            designProgress: scrDesign.get(scr.scrn_id) ?? 0, implProgress: scrImpl.get(scr.scrn_id) ?? 0,
            dDay: scr.actl_impl_end_de ? computeDDay(scr.actl_impl_end_de, today) : null,
            sortOrder: scr.sort_ordr,
            children: scr.areas.map((ar) => ({
              kind: "AREA", id: ar.area_id, displayId: ar.area_display_id, name: ar.area_nm,
              href: `/projects/${projectId}/areas/${ar.area_id}`,
              assigneeId: null, assigneeName: null,
              docStatus: ar.dsgn_doc_sttus_code,
              designStartDate: null, designEndDate: null, designEffort: null,
              implStartDate: null, implEndDate: null, implEffort: null,
              designProgress: null, implProgress: null,
              dDay: null,
              sortOrder: ar.sort_ordr,
              children: ar.functions.map((fn) => toFunctionNode(fn, {
                start: scr.actl_impl_bgng_de, end: scr.actl_impl_end_de,
              })),
            })),
          };
        }),
      };
    });

    // 영역이 아예 없는(또는 영역이 화면에 안 붙은) 기능 — 트리 최상위에 별도 노드로 얹는다.
    // 어느 단위업무 소속인지 알 방법이 없어(그게 문제 상황 자체) 구조상 위치를 줄 수 없음 —
    // 최상위에 홀로 뜨는 것 자체가 "정리가 필요한 항목"이라는 신호.
    const fullTree: MyTaskNode[] = [...tree, ...orphanFunctions.map((fn) => toFunctionNode(fn))];

    let allNodes: MyTaskNode[];
    if (view === "tree") {
      const pruned = assigneeId ? pruneToAssignee(fullTree, assigneeId) : fullTree;
      allNodes = sortTree(pruned, sortBy);
    } else {
      const flat = flattenSkipArea(fullTree);
      const filtered = assigneeId ? flat.filter((n) => n.assigneeId === assigneeId) : flat;
      allNodes = sortBy === "deadline" ? [...filtered].sort(byDeadline) : filtered;
    }

    // 페이징 — flat은 행 단위, tree는 최상위 노드 단위로 자른다(둘 다 같은 배열의 최상위 레벨).
    const totalCount = allNodes.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const nodes = allNodes.slice((page - 1) * pageSize, page * pageSize);

    const response: MyTaskResponse = {
      view, sortBy, assigneeId,
      nodes,
      page, pageSize, totalCount, totalPages,
      asOf: today,
    };

    return apiSuccess(response);
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/my-task] DB 오류:`, err);
    return apiError("DB_ERROR", "My Task 조회에 실패했습니다.", 500);
  }
}
