/**
 * pm/riskScore — 위험 점수 산정 (순수 함수)
 *
 * 입력: 단위업무 1건의 지표 (D-day, 진행률, 요구사항 우선순위, 담당자 유무)
 * 출력: 위험 점수 + 위험 사유 라벨
 *
 * 점수 가중치는 운영하며 조정. 룰을 한 곳에 모아 추후 변경 영향을 좁힘.
 *
 * 격리:
 *   - prisma·React 무관 → 단위 테스트 용이
 *   - PM 대시보드 외부에서 import 금지 (PM 전용 룰)
 */

import type { PriorityLevel, RiskItem } from "@/types/pm";

const W = {
  /** 지연 1일당 가산 (상한 50) */
  OVERDUE_PER_DAY: 5,
  OVERDUE_CAP:     50,
  /** D-3 이내 마감 임박 가산 */
  DUE_VERY_SOON:   15,
  /** D-7 이내 마감 임박 가산 (D-3 이내와 중복 X) */
  DUE_SOON:        8,
  /** 진행률 낮을수록 가산 — (100 - progress) × 계수 */
  PROGRESS_COEF:   0.3,
  /** 요구사항 우선순위 가산 */
  PRIORITY_HIGH:   20,
  PRIORITY_MEDIUM: 5,
  /** 미할당 — PM 이 가장 빨리 손대야 하는 시그널 */
  UNASSIGNED:      10,
};

export type RiskInput = {
  unitWorkId:   string;
  displayId:    string;
  name:         string;
  endDate:      string | null;
  dDay:         number | null;
  progress:     number;
  assigneeName: string | null;
  reqPriority:  PriorityLevel;
};

export function buildRiskItem(input: RiskInput): RiskItem {
  let score = 0;
  const reasons: string[] = [];

  // 마감 관련
  if (input.dDay !== null) {
    if (input.dDay < 0) {
      const overdueDays = Math.min(W.OVERDUE_CAP, -input.dDay);
      score += overdueDays * W.OVERDUE_PER_DAY;
      reasons.push(`지연 ${-input.dDay}일`);
    } else if (input.dDay <= 3) {
      score += W.DUE_VERY_SOON;
      reasons.push(input.dDay === 0 ? "오늘 마감" : `D-${input.dDay}`);
    } else if (input.dDay <= 7) {
      score += W.DUE_SOON;
      reasons.push(`D-${input.dDay}`);
    }
  }

  // 진행률 낮음
  score += (100 - input.progress) * W.PROGRESS_COEF;
  if (input.progress === 0) reasons.push("미시작");

  // 우선순위
  if (input.reqPriority === "HIGH") {
    score += W.PRIORITY_HIGH;
    reasons.push("고우선순위");
  } else if (input.reqPriority === "MEDIUM") {
    score += W.PRIORITY_MEDIUM;
  }

  // 미할당
  if (!input.assigneeName) {
    score += W.UNASSIGNED;
    reasons.push("미할당");
  }

  return {
    unitWorkId:   input.unitWorkId,
    displayId:    input.displayId,
    name:         input.name,
    endDate:      input.endDate,
    dDay:         input.dDay,
    progress:     input.progress,
    assigneeName: input.assigneeName,
    reqPriority:  input.reqPriority,
    riskScore:    Math.round(score * 10) / 10,
    reasons,
  };
}

/**
 * 위험도 점수 내림차순 정렬 후 상위 N개만 반환.
 * 점수 0 이하(=위험 없음) 는 제외.
 */
export function rankRiskItems(items: RiskItem[], limit: number): RiskItem[] {
  return [...items]
    .filter((it) => it.riskScore > 0)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, limit);
}
