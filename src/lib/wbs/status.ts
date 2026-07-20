/**
 * lib/wbs/status.ts — WBS 항목의 진행 상태 판정 (서버/클라이언트 공용)
 *
 * 클라이언트(WbsGanttChart의 "상태별 색상" 표시)와 서버(wbs API의 상태 필터) 양쪽에서
 * "지연이 뭔지"를 각자 계산하면 기준이 어긋날 수 있어 — 한 곳에서만 정의한다.
 */

export const WBS_STATUSES = ["wbs-done", "wbs-delayed", "wbs-in-progress", "wbs-not-started"] as const;
export type WbsStatus = (typeof WBS_STATUSES)[number];

export const WBS_STATUS_LABELS: Record<WbsStatus, string> = {
  "wbs-done":        "완료",
  "wbs-delayed":      "지연",
  "wbs-in-progress":  "진행중",
  "wbs-not-started":  "미시작",
};

/**
 * 완료=진척률 100%, 지연=오늘 기준 종료일 경과 + 미완료, 진행중=진척률 0~99%,
 * 미시작=진척률 0% (그리고 아직 마감 전).
 * end 가 없는 항목(날짜 미지정)은 지연 판정을 할 기준이 없어 진척률만으로 결정한다.
 */
export function computeWbsStatus(item: { progress: number; end: string | null }): WbsStatus {
  if (item.progress >= 100) return "wbs-done";

  if (item.end) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(`${item.end}T00:00:00`);
    if (endDate < today) return "wbs-delayed";
  }

  return item.progress > 0 ? "wbs-in-progress" : "wbs-not-started";
}
