/**
 * filters.ts — WBS 목록 조회 필터 (route.ts 전용)
 *
 * 조건을 한 함수(matchesWbsFilters)에 모아둔다 — 나중에 필터 종류가 늘어나도(예: 담당 직무,
 * 우선순위) 여기 조건 하나만 추가하면 되고, route.ts의 GET 핸들러는 안 건드려도 된다.
 * 페이지네이션보다 먼저 적용해야 "페이지당 N건" 숫자가 필터링된 결과 기준으로 맞는다.
 */

import { computeWbsStatus, WBS_STATUSES, type WbsStatus } from "@/lib/wbs/status";

export type WbsFilterParams = {
  status?:    WbsStatus; // 없으면(undefined) 전체
  startFrom?: string;    // YYYY-MM-DD — 시작일이 이 날짜 이상인 것만
  startTo?:   string;    // YYYY-MM-DD — 시작일이 이 날짜 이하인 것만
};

type FilterableItem = { progress: number; start: string | null; end: string | null };

export function matchesWbsFilters(item: FilterableItem, filters: WbsFilterParams): boolean {
  if (filters.status && computeWbsStatus(item) !== filters.status) return false;
  if (filters.startFrom && (!item.start || item.start < filters.startFrom)) return false;
  if (filters.startTo && (!item.start || item.start > filters.startTo)) return false;
  return true;
}

export function parseWbsFilterParams(url: URL): WbsFilterParams {
  const statusParam = url.searchParams.get("status");
  const status = statusParam && (WBS_STATUSES as readonly string[]).includes(statusParam)
    ? (statusParam as WbsStatus)
    : undefined;

  return {
    status,
    startFrom: url.searchParams.get("startFrom") || undefined,
    startTo:   url.searchParams.get("startTo") || undefined,
  };
}
