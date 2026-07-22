/**
 * weekUtil — 업무일지/주간보고 공통 "주(week) 월요일 계산" 유틸 + 쿼리 무효화 헬퍼
 *
 * work-logs(WEEK 타입 log_dt) / weekly-reports(week_start_dt) 양쪽 API 라우트와
 * 페이지 컴포넌트(기본 선택 주) 에서 동일 기준으로 써야 어긋나지 않는다.
 */

import type { QueryClient } from "@tanstack/react-query";

// dateStr(YYYY-MM-DD) 이 속한 주의 월요일을 YYYY-MM-DD 로 반환. 생략 시 오늘 기준.
// UTC 기준 계산 — 서버/클라이언트 타임존 차이로 요일이 밀리는 것을 방지.
export function getWeekMondayStr(dateStr?: string): string {
  const base = dateStr ? new Date(dateStr + "T00:00:00Z") : new Date();
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  const day = d.getUTCDay(); // 0=일 ~ 6=토
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

export function addDaysStr(dateStr: string, deltaDays: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

// 0=일 ~ 6=토 — HistoryTab(주말 강조)과 groupByWeek(월요일 경계) 공통 기준
export function dayOfWeek(dateStr: string): number {
  return new Date(dateStr + "T00:00:00Z").getUTCDay();
}

// 연도 없이 월/일만 — 업무 리포트(WeeklyDocView·월간 구분선)에서 좁은 칸에 전체 날짜를
// 쓰면 옆 칸과 겹쳐 보이던 문제로 짧게 표기한다.
export function mmdd(dateStr: string): string {
  return `${dateStr.slice(5, 7)}/${dateStr.slice(8, 10)}`;
}
export function mmddRange(from: string, to: string): string {
  return `${mmdd(from)} ~ ${mmdd(to)}`;
}

// ── 월(month) 단위 유틸 — HistoryTab(기록 보기)와 work-report(업무 리포트) 공통 ──────

export function getMonthStart(dateStr: string): string {
  return dateStr.slice(0, 7) + "-01";
}

export function getMonthLabel(monthStart: string): string {
  const [y, m] = monthStart.split("-");
  return `${y}년 ${m}월`;
}

export function addMonths(monthStart: string, delta: number): string {
  const [y, m] = monthStart.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 10);
}

// monthStart(YYYY-MM-01)가 속한 달의 모든 날짜를 YYYY-MM-DD 배열로 반환
export function getMonthDays(monthStart: string): string[] {
  const [y, m] = monthStart.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // 다음달 0일 = 이번달 마지막 날
  const prefix = monthStart.slice(0, 8); // "YYYY-MM-"
  return Array.from({ length: lastDay }, (_, i) => `${prefix}${String(i + 1).padStart(2, "0")}`);
}

// 월요일마다 새 주 그룹 시작 — 달 첫/마지막 주는 7일이 안 채워질 수 있음(정상)
export function groupByWeek(days: string[]): string[][] {
  const weeks: string[][] = [];
  let current: string[] = [];
  for (const d of days) {
    if (dayOfWeek(d) === 1 && current.length > 0) {
      weeks.push(current);
      current = [];
    }
    current.push(d);
  }
  if (current.length > 0) weeks.push(current);
  return weeks;
}

// ── 쿼리 무효화 — 업무일지/업무 리포트가 공유하는 모든 work-log 계열 캐시 ──────────
//
// 저장 후 화면에서 방금 쓴 내용이 사라졌다가 새로고침해야 돌아오는 버그가 있었다:
// 컴포넌트마다 쓰는 queryKey 접두어가 "work-log"(DayCard/WeekPlanRow), "work-log-range"
// (업무 리포트의 5일치 범위 조회), "work-log-history"(기록 보기)로 제각각이라, exact 매치인
// invalidateQueries({queryKey:["work-log"]}) 로는 "work-log-range" 등을 무효화하지 못했다
// — 저장은 서버에 반영됐지만 화면이 구 캐시(저장 전 값)를 계속 보여준 것.
// predicate 로 첫 번째 키 요소가 "work-log" 로 시작하는 쿼리를 전부 잡아 한 번에 해결한다.
export function invalidateWorkLogQueries(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const first = query.queryKey[0];
      return typeof first === "string" && first.startsWith("work-log");
    },
  });
}
