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

// ── "그 달의 N주" 계산 — 수요일 기준으로 그 주가 속한 달을 정한다 ────────────────
//
// 예: 월요일이 07/27(7월)이어도 수요일(07/29)이 7월이면 그 주는 7월 소속. 월요일이 08/03
// (8월)이고 수요일도 08/05(8월)면 8월 소속. 이렇게 하면 매 달 걸치는 경계 주가 어느 한쪽에
// 확실히 귀속된다.
//
// 이전엔 monday 자신의 달(monday.slice(5,7))로 라벨을 붙이고, 화면에 지금 펼쳐 놓은 배열
// 안에서의 위치(idx+1)로 번호를 매겼다 — 그래서 8월을 보는 중에 7월 말 경계 주가 그 배열의
// 첫 항목이 되면 "7월 1주"처럼 앞뒤가 안 맞는 라벨이 나오는 버그가 있었다(2026-07-24).
// 이제 각 주가 화면에 어떤 달이 펼쳐져 있는지와 무관하게, monday 하나만으로 스스로 "내가
// 속한 달"과 "그 달의 몇 번째 주인지"를 계산한다.
// monthStart(YYYY-MM-01)가 속한 달에 "귀속"되는 주(월요일 배열) — 수요일이 그 달에 속하는
// 주만 순서대로 골라낸다(위 getWeekOfMonthLabel 설명 참고). 업무일지 "이번 달 주" 선택
// 버튼 줄(1주/2주/3주...)이 이 배열의 인덱스를 그대로 번호로 쓴다(2026-07-24d).
export function getOwnedWeeksOfMonth(monthStart: string): string[] {
  const monthEnd = getMonthDays(monthStart).at(-1)!;
  const targetYM = monthStart.slice(0, 7);
  const weeks: string[] = [];
  let cursor = getWeekMondayStr(monthStart);
  const lastCursor = getWeekMondayStr(monthEnd);
  while (cursor <= lastCursor) {
    if (addDaysStr(cursor, 2).slice(0, 7) === targetYM) weeks.push(cursor);
    cursor = addDaysStr(cursor, 7);
  }
  return weeks;
}

export function getWeekOfMonthLabel(monday: string): { monthStart: string; weekIndex: number } {
  const wednesday  = addDaysStr(monday, 2);
  const monthStart = getMonthStart(wednesday);
  const ownedWeeks = getOwnedWeeksOfMonth(monthStart);
  return { monthStart, weekIndex: ownedWeeks.indexOf(monday) + 1 };
}

// 실제 "오늘 기준" 이번/다음/지난 주면 그 이름으로, 그 외엔 "OO월 N주"로 — 업무일지에서
// 임의의 주를 탐색해도 "이번 주"라고 잘못 부르지 않도록 한다(2026-07-24, WeekPlanRow가
// 탐색 중인 주도 항상 "이번 주"라고 표시하던 버그 수정 겸용).
export function getRelativeWeekLabel(monday: string): string {
  const thisMonday = getWeekMondayStr();
  if (monday === thisMonday) return "이번 주";
  if (monday === addDaysStr(thisMonday, 7)) return "다음 주";
  if (monday === addDaysStr(thisMonday, -7)) return "지난 주";
  const { monthStart, weekIndex } = getWeekOfMonthLabel(monday);
  return `${monthStart.slice(5, 7)}월 ${weekIndex}주`;
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

// ── 프로젝트 "N주차" 계산 — 리더 리포트 인쇄본/엑셀 공용 ───────────────────────
//
// 캘린더 기준(ISO 주차)이 아니라 프로젝트 시작일 기준으로 센다. 시작일이 월~목요일이면 그
// 주에 근무일이 2~5일 남아 있어 그 주를 그대로 1주차로 치지만, 금~일요일 시작이면 그 주에
// 남은 근무일이 0~1일뿐이라 다음 주 월요일부터를 1주차로 민다 — ISO 8601이 "그 주에 목요일이
// 포함되는지"로 주차를 가르는 것과 같은 컷오프(2026-07-25). 화면(PrintPreviewModal)과 엑셀
// (xlsx/route.ts)이 각자 같은 로직을 복붙해 두던 것을 여기 하나로 합쳤다 — 둘이 어긋나면
// 안 되는 값이라 공용 유틸이 맞다.
export function computeProjectWeekIndex(bgngDt: string | null, monday: string): number | null {
  if (!bgngDt) return null;
  const startDate = bgngDt.slice(0, 10);
  const startWeekMonday = getWeekMondayStr(startDate);
  const startWeekday = dayOfWeek(startDate); // 0=일 ~ 6=토
  const hasEnoughDaysThisWeek = startWeekday >= 1 && startWeekday <= 4; // 월~목만 그 주를 그대로 사용
  const anchorMonday = hasEnoughDaysThisWeek ? startWeekMonday : addDaysStr(startWeekMonday, 7);

  const diffDays = Math.round(
    (new Date(monday + "T00:00:00Z").getTime() - new Date(anchorMonday + "T00:00:00Z").getTime()) /
      (1000 * 60 * 60 * 24)
  );
  return Math.floor(diffDays / 7) + 1;
}

// WeekPlanRow 상단 4칸(계획×2 + 결과 요약×2) 공통 카드 높이 — "계획" 카드가 체크리스트/관련
// 일감 항목 수에 따라 제각각 늘어나면서 옆 "결과 요약" 카드와 높이가 안 맞던 문제가 있었다.
// 계획 카드 내부(체크리스트 5개·관련일감 2줄)를 스크롤로 캡핑한 뒤, 이 고정 높이를 4칸 전부에
// 강제해서 맞춘다(2026-07-24e).
export const WEEK_SUMMARY_CARD_HEIGHT = 360;

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
