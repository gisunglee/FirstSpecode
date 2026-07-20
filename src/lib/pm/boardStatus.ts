/**
 * pm/boardStatus — PM 현황 카테고리 하나(진척 4구간 분포 + 마감 임박 정렬) 조립 (순수 함수)
 *
 * DB 조회는 pm-board-summary/route.ts 가 lib/pm/fetchDeadlineItems.ts(기존 재사용) +
 * 자체 요구사항/계층명 조회로 이미 끝내둔 뒤, 이 파일에는 가공된 배열만 넘긴다.
 * lib/pm/deadlineProgress.ts 의 computeDDay 를 그대로 재사용 — 마감 임박 정렬 기준을
 * 다른 PM 위젯들과 통일하기 위함(같은 dDay 계산식을 여기서 새로 만들지 않음).
 *
 * 격리:
 *   - prisma·React 무관 → 단위 테스트 용이 (lib/pm/riskScore.ts 등과 같은 패턴)
 *   - PM 현황 외부에서 import 금지
 */

import { computeDDay } from "./deadlineProgress";
import type { BoardCategory, BoardCategoryKind, BoardItem, ProgressBucket4 } from "@/types/pm";

// 0% → 미지정, 1~50% → 진행중(~50), 51~99% → 진행중(~99), 100% → 완료.
// "미지정"은 진척률 0%를 뜻한다(마감일 유무와는 무관 — 마감일 없는 항목은 dDay=null 로만 표현하고
// 리스트 정렬에서 맨 뒤로 보낸다. 별도 버킷으로 안 쪼갬 — 이미 PM 진단의 "미지정 현황" 위젯이
// 담당자/일정/공수 입력 누락을 따로 다루고 있어, 여기서까지 겹치게 만들지 않기 위함).
export function classifyProgress4(progress: number): ProgressBucket4 {
  if (progress <= 0)  return "UNSET";
  if (progress <= 50) return "IN_PROGRESS_50";
  if (progress <= 99) return "IN_PROGRESS_99";
  return "DONE";
}

export type BoardItemInput = {
  id: string; displayId: string; name: string; href: string;
  parentNames: string[];
  mberId: string | null; memberName: string | null;
  startDate: string | null; endDate: string | null;
  /** 0~100 */
  progress: number;
};

export function buildBoardCategory(
  kind: BoardCategoryKind,
  label: string,
  items: BoardItemInput[],
  todayStr: string
): BoardCategory {
  const withDerived: BoardItem[] = items.map((it) => ({
    ...it,
    dDay:   it.endDate ? computeDDay(it.endDate, todayStr) : null,
    bucket: classifyProgress4(it.progress),
  }));

  const buckets: Record<ProgressBucket4, number> = {
    UNSET: 0, IN_PROGRESS_50: 0, IN_PROGRESS_99: 0, DONE: 0,
  };
  for (const it of withDerived) buckets[it.bucket]++;

  // pm-deadline-list/route.ts 와 동일한 정렬: dDay 오름차순(지연=음수 먼저), null 은 맨 뒤,
  // 동률이면 이름 오름차순으로 안정 정렬.
  withDerived.sort((a, b) => {
    if (a.dDay === null && b.dDay === null) return a.name.localeCompare(b.name);
    if (a.dDay === null) return 1;
    if (b.dDay === null) return -1;
    if (a.dDay !== b.dDay) return a.dDay - b.dDay;
    return a.name.localeCompare(b.name);
  });

  return {
    kind, label, buckets,
    totalCount: items.length,
    items: withDerived,
  };
}
