/**
 * 포커스 모드 타입 — 클라이언트/서버 공유
 *
 * 격리 원칙:
 *   - dashboard.ts, activity.ts 와 독립
 *   - "오늘 내가 가장 먼저 해야 할 일 한 건" 컨셉이라 모델이 단순
 */

// ── 포커스 후보 아이템 ──────────────────────────────────────────────────────
//
// 1차 MVP 는 단위업무만 대상 — 마감일·진행률·담당자가 모두 있는 유일한 엔티티.
// 추후 확장: AI 결과 대기·검토 요청 등으로 확장 가능.
export type FocusItem = {
  /** 안정 키 */
  itemId: string;
  /** 단위업무 표시 ID (예: UW-00012) */
  displayId: string;
  /** 단위업무 이름 */
  name:      string;
  /** 종료일 (YYYY-MM-DD) — null 가능 (마감 미설정) */
  endDate:   string | null;
  /** 진행률 0~100 */
  progress:  number;
  /**
   * D-day. 음수 = 지연(일수), 0 = 오늘, 양수 = 남은 일수.
   * endDate 가 null 이면 null.
   */
  dDay:      number | null;
  /** 담당자 표시명 */
  assigneeName: string | null;
  /** 상위 요구사항 표시 ID (예: RQ-00007) */
  reqDisplayId: string;
  /** 우선순위 점수 — 디버깅용. 정렬 기준이 명확하지 않을 때 참조. */
  priorityScore: number;
};

export type FocusResponse = {
  /** 가장 우선순위 높은 항목 1건 (null = 처리할 일 없음) */
  primary: FocusItem | null;
  /** 다음 후보 2건 */
  next:    FocusItem[];
  /**
   * "오늘 같이 보면 좋은" 부가 시그널.
   * 첫 페이지에서 "오늘 활동 가능성"을 가늠하는 데 쓰임.
   */
  context: {
    /** 내가 담당한 미완료 단위업무 총 건수 */
    myOpenCount: number;
    /** 그 중 지연(end_de < 오늘) 건수 */
    myOverdueCount: number;
  };
};
