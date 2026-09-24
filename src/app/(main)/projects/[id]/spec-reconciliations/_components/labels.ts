/** 스펙 동기화 상태·판정 코드를 화면 문구와 배지 스타일로 변환한다. */

import type { SyncDecisionCounts } from "./types";

export function statusBadgeClass(status: string) {
  if (status === "COMPLETED") return "sp-badge-success";
  if (["FAILED", "CANCELLED"].includes(status)) return "sp-badge-error";
  if (status === "RUNNING") return "sp-badge-info";
  return "sp-badge-warning";
}

export function resultBadgeClass(result: string) {
  if (["MATCH", "IMPLEMENTATION_DETAIL", "OUT_OF_SCOPE"].includes(result)) {
    return "sp-badge-success";
  }
  if (
    [
      "MISMATCH",
      "NOT_IMPLEMENTED",
      "IMPORTANT_GAP_CANDIDATE",
      "GAP_CANDIDATE",
      "STRUCTURE_GAP",
    ].includes(result)
  ) {
    return "sp-badge-warning";
  }
  return "sp-badge-info";
}

export function resultLabel(result: string) {
  const labels: Record<string, string> = {
    MATCH: "구현됨",
    MISMATCH: "설계와 다름",
    NOT_IMPLEMENTED: "미구현",
    UNKNOWN: "확인 필요",
    IMPORTANT_GAP_CANDIDATE: "중요 설계 누락 후보",
    GAP_CANDIDATE: "설계 누락 후보",
    STRUCTURE_GAP: "신규 구조 필요",
    IMPLEMENTATION_DETAIL: "구현 세부",
    OUT_OF_SCOPE: "UW 범위 밖",
  };
  return labels[result] ?? result;
}

export function itemStatusBadgeClass(status: string) {
  if (status === "APPLIED") return "sp-badge-success";
  if (status === "DESIGN_CHANGED") return "sp-badge-error";
  // PENDING은 카드의 노란 띠와 결정 박스가 이미 알리므로 배지는 무채색으로 낮춘다.
  return "sp-badge-neutral";
}

export function itemStatusLabel(status: string) {
  const labels: Record<string, string> = {
    INFORMATIONAL: "정보",
    PENDING: "결정 대기",
    APPLIED: "적용됨",
    REJECTED: "거부됨",
    DEFERRED: "보류됨",
    DESIGN_CHANGED: "설계 변경됨",
  };
  return labels[status] ?? status;
}

export function verdictLabel(value: string | null) {
  if (!value) return "분석 대기";
  const labels: Record<string, string> = {
    PASS: "설계대로 구현",
    FAIL: "불일치 있음",
    UNKNOWN: "확인 필요",
    CLEAR: "중요 누락 없음",
    GAP_CANDIDATE: "누락 후보 있음",
  };
  return labels[value] ?? value;
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

// ─── 실행 상태 표시 ───────────────────────────────────────────────
// DB 상태 코드는 PENDING 항목이 0이면 COMPLETED가 된다. 그러나 DESIGN_CHANGED로
// 끝난 항목은 실제로는 반영되지 않았으므로, 그런 실행을 "완료"로 보여주면
// 사용자가 미반영 항목을 놓친다. DB 코드는 그대로 두고 화면에서만
// "재분석 필요"로 파생해 표시한다.

const RUN_STATUS_LABEL: Record<string, string> = {
  RUNNING: "분석 중",
  NEEDS_INPUT: "범위 확인 필요",
  NEEDS_REVIEW: "검토 필요",
  COMPLETED: "완료",
  FAILED: "실패",
  CANCELLED: "취소",
};

export function needsReanalysis(status: string, designChangedCount: number) {
  return status === "COMPLETED" && designChangedCount > 0;
}

export function runStatusLabel(status: string, designChangedCount: number) {
  if (needsReanalysis(status, designChangedCount)) return "재분석 필요";
  return RUN_STATUS_LABEL[status] ?? status;
}

export function runStatusBadgeClass(status: string, designChangedCount: number) {
  if (needsReanalysis(status, designChangedCount)) return "sp-badge-warning";
  return statusBadgeClass(status);
}

// ─── 처리 현황 요약 ───────────────────────────────────────────────
// 목록의 "문제" 열과 상세의 요약 셀이 같은 순서·같은 문구·같은 색을 쓴다.
// 0건인 항목은 생략해 눈에 들어오는 숫자만 남긴다.

export type DecisionCountChip = {
  code: keyof SyncDecisionCounts;
  label: string;
  count: number;
  badgeClass: string;
};

export function decisionCountChips(counts: SyncDecisionCounts): DecisionCountChip[] {
  const chips: DecisionCountChip[] = [
    { code: "appliedCount", label: "적용", count: counts.appliedCount, badgeClass: "sp-badge-success" },
    { code: "rejectedCount", label: "거부", count: counts.rejectedCount, badgeClass: "sp-badge-neutral" },
    { code: "deferredCount", label: "보류", count: counts.deferredCount, badgeClass: "sp-badge-neutral" },
    { code: "designChangedCount", label: "설계변경", count: counts.designChangedCount, badgeClass: "sp-badge-error" },
    { code: "pendingCount", label: "대기", count: counts.pendingCount, badgeClass: "sp-badge-warning" },
  ];
  return chips.filter((chip) => chip.count > 0);
}
