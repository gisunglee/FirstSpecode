/** 스펙 동기화 상태·판정 코드를 화면 문구와 배지 스타일로 변환한다. */

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
  if (status === "PENDING") return "sp-badge-warning";
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
