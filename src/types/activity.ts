/**
 * 활동 피드 타입 — 클라이언트/서버 공유
 *
 * 격리 원칙:
 *   - dashboard.ts 와 의존성 없음 — 독립 삭제·교체 가능
 *   - 카드 그리드 대시보드와는 다른 패러다임이라 타입도 분리
 */

// ── 이벤트 타입 코드 ────────────────────────────────────────────────────────
//
// 1차 MVP 는 3종만:
//   - DESIGN_CHANGE : tb_ds_design_change (생성/수정/삭제)
//   - REVIEW_REQUEST: tb_ds_review_request (요청 발생 시점)
//   - AI_TASK_DONE  : tb_ai_task (status=DONE, compl_dt 기준)
//
// 추후 확장: REVIEW_RESPONSE, REVIEW_COMMENT, BASELINE_SNAPSHOT, MEMBER_JOINED ...
export type ActivityKind =
  | "DESIGN_CHANGE"
  | "REVIEW_REQUEST"
  | "AI_TASK_DONE";

// ── 단일 활동 행 ────────────────────────────────────────────────────────────
//
// "누가 / 언제 / 어떤 동작 / 어떤 대상" 4요소를 한 객체에 담는다.
// 행위자 표시명은 서버에서 미리 join 해서 보냄 — 클라이언트 N+1 방지.
export type ActivityEvent = {
  /** 안정 키 (이벤트 종류 + 원본 PK) — 중복 ID 충돌 방지를 위해 prefix 부여 */
  eventId: string;
  /** 종류 — 아이콘/색상/동사 선택에 사용 */
  kind: ActivityKind;
  /** 실제 발생 시각 (ISO 문자열) */
  occurredAt: string;
  /** 행위자 mberId (없을 수 있음 — 시스템/배치) */
  actorMberId: string | null;
  /** 행위자 표시명 (mber_nm 우선, email_addr fallback) */
  actorName: string | null;

  /**
   * 대상 객체 식별 — refTblNm + refId 형태
   * (단위업무/화면/영역/기능/요구사항 등 다양한 대상에 공통 매핑)
   */
  targetTblNm: string | null;
  targetId:    string | null;
  /** 대상 라벨 — "[UW-00012] 로그인 화면" 식으로 미리 조합 (서버) */
  targetLabel: string | null;

  /**
   * 부가 정보 — 종류별 의미가 다른 자유 필드
   *   DESIGN_CHANGE  → chgTypeCode (CREATE/UPDATE/DELETE) + 변경 사유
   *   REVIEW_REQUEST → 검토 제목 + 검토자 표시명
   *   AI_TASK_DONE   → task_ty_code (INSPECT/DESIGN/...) + ref_ty_code
   */
  meta: Record<string, string | null>;
};

// ── API 응답 ────────────────────────────────────────────────────────────────
//
// 무한 스크롤용 커서 페이지네이션:
//   - 클라이언트는 nextCursor 가 null 일 때까지 계속 요청
//   - 커서 = 가장 오래된 항목의 occurredAt ISO (서버는 이 시각보다 더 옛것을 반환)
export type ActivityFeedResponse = {
  events: ActivityEvent[];
  /** 다음 페이지를 위한 커서 — null 이면 더 이상 없음 */
  nextCursor: string | null;
};

// ── 필터 옵션 ──────────────────────────────────────────────────────────────
export type ActivityRangeKey = "today" | "7d" | "30d" | "all";

// 기간 키 → 일수. "all" 은 무제한(서버에서 제한).
export const ACTIVITY_RANGE_DAYS: Record<ActivityRangeKey, number | null> = {
  today: 1,
  "7d":  7,
  "30d": 30,
  all:   null,
};

export const ACTIVITY_RANGE_LABEL: Record<ActivityRangeKey, string> = {
  today: "오늘",
  "7d":  "최근 7일",
  "30d": "최근 30일",
  all:   "전체",
};
