/**
 * pm/deadlineProgress — 마감 근접도 × 진척률 매트릭스 집계 (순수 함수)
 *
 * lib/pm/delayStatus.ts, lib/pm/missingStatus.ts 와 같은 격리 원칙 — prisma·React 무관,
 * PM 대시보드 외부에서 import 금지.
 *
 * dDay = 마감일 - 기준일. 기준일은 호출자가 넘긴 todayStr(yyyy-MM-dd) — asOf 파라미터가
 * 있으면 그 값, 없으면 실제 오늘(pm-deadline-progress/route.ts 에서 이미 결정해서 넘겨줌).
 */

import type { DeadlineBucket, ProgressBucket, DeadlineProgressMatrix } from "@/types/pm";
import { DEADLINE_BUCKET_ORDER, PROGRESS_BUCKET_ORDER } from "@/types/pm";

export type DeadlineProgressInput = {
  /** yyyy-MM-dd. null 이면 이 그리드에서 제외(excludedNoDeadline 으로 카운트) */
  endDate:  string | null;
  /** 0~100 — 항상 기능(impl_rt) 기준 롤업값 */
  progress: number;
};

// 마감일 - 기준일 = dDay(정수, 음수=지연). endDate/todayStr 둘 다 yyyy-MM-dd.
// export — pm-deadline-progress-detail/route.ts 가 동일 계산식 재사용
export function computeDDay(endDate: string, todayStr: string): number {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  return Math.round(
    (new Date(endDate + "T00:00:00Z").getTime() - new Date(todayStr + "T00:00:00Z").getTime()) / MS_PER_DAY
  );
}

// dDay(정수, 음수=지연) → 6구간 중 하나
// export — pm-deadline-progress-detail/route.ts 가 셀 클릭 필터링에 동일 기준으로 재사용
export function classifyDeadline(dDay: number): DeadlineBucket {
  if (dDay < 0) return "OVERDUE";
  if (dDay <= 1) return "D1";
  if (dDay <= 3) return "D3";
  if (dDay <= 5) return "D5";
  if (dDay <= 7) return "D7";
  return "D8_PLUS";
}

// 진척률(0~100) → 6구간 중 하나
// export — pm-deadline-progress-detail/route.ts 가 셀 클릭 필터링에 동일 기준으로 재사용
export function classifyProgress(progress: number): ProgressBucket {
  if (progress <= 0)   return "P0";
  if (progress <= 25)  return "P1_25";
  if (progress <= 50)  return "P26_50";
  if (progress <= 75)  return "P51_75";
  if (progress <= 99)  return "P76_99";
  return "P100";
}

function emptyCells(): Record<DeadlineBucket, Record<ProgressBucket, number>> {
  const cells = {} as Record<DeadlineBucket, Record<ProgressBucket, number>>;
  for (const d of DEADLINE_BUCKET_ORDER) {
    cells[d] = {} as Record<ProgressBucket, number>;
    for (const p of PROGRESS_BUCKET_ORDER) cells[d][p] = 0;
  }
  return cells;
}

export function buildDeadlineProgressMatrix(
  items: DeadlineProgressInput[],
  todayStr: string
): DeadlineProgressMatrix {
  const cells = emptyCells();
  let excludedNoDeadline = 0;
  let totalCount = 0;

  for (const it of items) {
    if (!it.endDate) {
      excludedNoDeadline++;
      continue;
    }
    const dDay = computeDDay(it.endDate, todayStr);
    const dBucket = classifyDeadline(dDay);
    const pBucket = classifyProgress(it.progress);
    cells[dBucket][pBucket]++;
    totalCount++;
  }

  return { cells, excludedNoDeadline, totalCount };
}
