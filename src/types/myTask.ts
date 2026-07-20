/**
 * My Task 타입 — 클라이언트/서버 공유
 *
 * 격리 원칙: myWork.ts, dashboard.ts, focus.ts, pm.ts 와 완전 독립.
 *
 * /my-work 와의 차이:
 *   - /my-work 는 "나 한 사람"만 보는 개인 스냅샷(요구사항 포함).
 *   - 이건 단위업무/화면/기능(요구사항 제외)을 팀 전체 누구 것이든 조회하고,
 *     담당자·일정·공수를 그 자리에서 바로 수정할 수 있는 화면.
 */

export type MyTaskKind = "UNIT_WORK" | "SCREEN" | "AREA" | "FUNCTION";

export const MY_TASK_KIND_LABELS: Record<MyTaskKind, string> = {
  UNIT_WORK: "단위업무",
  SCREEN:    "화면",
  AREA:      "영역",
  FUNCTION:  "기능",
};

export type MyTaskView   = "flat" | "tree";
export type MyTaskSortBy = "deadline" | "sortOrder";

/**
 * 트리 노드 — flat 응답에서도 같은 모양을 쓰되 children은 항상 빈 배열.
 * 영역(AREA)은 담당자/일정/공수가 전부 null(스키마 자체에 해당 필드가 없음) —
 * 구조상 위치만 보여주는 통로 노드.
 */
export type MyTaskNode = {
  kind:       MyTaskKind;
  id:         string;
  displayId:  string;
  name:       string;
  href:       string;
  assigneeId:   string | null;
  assigneeName: string | null;
  startDate: string | null;
  endDate:   string | null;
  /** 공수 — SCREEN(design_efrt_val)/FUNCTION(efrt_val)만. UNIT_WORK/AREA는 항상 null(필드 없음) */
  effort: string | null;
  /**
   * 설계/구현 진척률(0~100) — "진척률은 기능걸로 통일" 원칙(fetchDeadlineItems.ts와 동일).
   * FUNCTION은 자기 자신의 impl_rt/design_rt, UNIT_WORK/SCREEN은 하위 기능들의 평균 롤업.
   * AREA는 진척률 개념이 없어 항상 null.
   */
  designProgress: number | null;
  implProgress:   number | null;
  /** 기준일 - 마감일. 마감일 없으면 null */
  dDay: number | null;
  sortOrder: number;
  /** flat 응답에서는 항상 [] */
  children: MyTaskNode[];
};

export type MyTaskResponse = {
  view:       MyTaskView;
  sortBy:     MyTaskSortBy;
  /** 이 값으로 필터된 결과 — tree는 자신이 담당이거나 하위에 담당 항목이 있는 가지만 남긴다 */
  assigneeId: string | null;
  /** 현재 페이지의 최상위 노드만(flat=행, tree=단위업무 루트) — 페이징된 결과 */
  nodes: MyTaskNode[];
  page:       number;
  pageSize:   number;
  /** 페이징 전 최상위 노드 총 개수(flat=총 행 수, tree=총 단위업무 루트 수) */
  totalCount: number;
  totalPages: number;
  asOf: string;
};
