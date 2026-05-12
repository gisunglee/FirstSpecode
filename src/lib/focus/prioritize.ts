/**
 * focus/prioritize — "오늘 뭐부터?" 우선순위 산정 로직 (순수 함수)
 *
 * 입력: 단위업무 후보 목록
 * 출력: 우선순위 점수가 매겨진 정렬된 목록
 *
 * 점수 산정 원칙 (높을수록 우선):
 *   1) 지연(D+N) > 임박(D-day, D-1, D-2) > 일반 임박(D-3~D-7) > 마감 없음
 *   2) 같은 D-day 면 진행률이 낮은 쪽이 우선 (시작도 못한 작업 먼저)
 *   3) 마감 없는 것은 마감 있는 것 뒤로 — "마감이 분명한 일을 먼저"
 *
 * 격리:
 *   - 순수 함수. prisma·request 무관 → 단위 테스트 가능.
 *   - API 라우트에서 import 해서 사용.
 */

import type { FocusItem } from "@/types/focus";

// ── 점수 가중치 ─────────────────────────────────────────────────────────────
//
// 합산 점수가 클수록 우선. 값은 경험치 — 운영하며 미세 조정.
const SCORE = {
  /** 지연 1일당 가산 (상한 30점) — 너무 오래 지연된 건이 1순위로 가도록 */
  OVERDUE_PER_DAY: 5,
  OVERDUE_CAP:     30,

  /** 마감 임박 가산 — D-day=20, D-1=15, D-2=12, D-3=8, ... */
  DDAY_BASE:       20,
  DDAY_DECAY:      4,    // 하루 멀어질수록 빼는 점수

  /** 미시작(진행률=0) 가산 — 같은 마감이면 안 시작한 게 우선 */
  ZERO_PROGRESS:   3,
  /** 진행률 낮을수록 미세 가산 — (100 - progress) × 이 계수 */
  PROGRESS_WEIGHT: 0.02,

  /** 마감 없음 페널티 — 마감 있는 것보다 무조건 뒤 */
  NO_DEADLINE:    -50,
};

export function scorePriority(item: FocusItem): number {
  let score = 0;

  if (item.dDay === null) {
    // 마감 없음
    score += SCORE.NO_DEADLINE;
  } else if (item.dDay < 0) {
    // 지연 — 일수만큼 가산(상한)
    const overdueDays = Math.min(SCORE.OVERDUE_CAP, -item.dDay);
    score += overdueDays * SCORE.OVERDUE_PER_DAY;
  } else {
    // 임박 — D-day 가까울수록 큼
    const proximity = Math.max(0, SCORE.DDAY_BASE - item.dDay * SCORE.DDAY_DECAY);
    score += proximity;
  }

  // 미시작 가산
  if (item.progress === 0) score += SCORE.ZERO_PROGRESS;
  // 진행률 낮을수록 미세 가산
  score += (100 - item.progress) * SCORE.PROGRESS_WEIGHT;

  return score;
}

/**
 * 우선순위 정렬 — 점수 내림차순. 동점 시 endDate 오름차순(이른 마감 먼저).
 * 입력 배열을 변형하지 않음 (불변성 유지).
 */
export function prioritize(items: FocusItem[]): FocusItem[] {
  return [...items]
    .map((it) => ({ ...it, priorityScore: scorePriority(it) }))
    .sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      // 동점: 마감 이른 것 먼저. null 은 뒤로.
      if (a.endDate === b.endDate) return 0;
      if (a.endDate === null) return 1;
      if (b.endDate === null) return -1;
      return a.endDate < b.endDate ? -1 : 1;
    });
}
