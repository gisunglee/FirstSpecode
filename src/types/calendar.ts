/**
 * 캘린더 타입 — 클라이언트/서버 공유
 *
 * 격리 원칙: 다른 대시보드 타입과 독립.
 *
 * 2026-07-29 개편 — "단위업무 종료일만" 보여주던 1차 MVP에서, 프로젝트 설정(일정 탭)의
 * 단계일정·마일스톤·공휴일 + 요구사항/단위업무 설계/화면 구현 일정까지 묶어 보여주는
 * 통합 이벤트 모델로 확장. 6종류를 전부 같은 모양(CalendarEvent)으로 내려주고,
 * 캘린더 상단 체크박스는 새 쿼리 없이 클라이언트에서 카테고리 필터만 한다(월 단위라
 * 전체 이벤트 수가 적어 매번 다시 조회할 필요가 없음).
 */

export type CalendarEventCategory =
  | "PHASE"             // 프로젝트 설정 > 일정 탭의 단계일정(분석/설계/구현/테스트 시작·종료)
  | "MILESTONE"         // 프로젝트 설정 > 일정 탭의 마일스톤
  | "HOLIDAY"           // 프로젝트 설정 > 일정 탭의 공휴일 — 배지가 아니라 셀 배경으로 표시
  | "REQUIREMENT"       // 요구사항 분석 시작/종료일
  | "UNIT_WORK_DESIGN"  // 단위업무 계획설계 시작/종료일
  | "SCREEN_IMPL";      // 화면 실질구현 시작/종료일

export type CalendarEvent = {
  category: CalendarEventCategory;
  /** YYYY-MM-DD */
  date: string;
  /** 배지(또는 공휴일은 날짜 아래 텍스트)에 표시할 라벨 */
  label: string;
  /** 클릭 시 이동할 상세 페이지 — 이동할 곳이 없는 카테고리(단계일정/마일스톤/공휴일)는 null */
  href: string | null;
  /**
   * 0~100 — REQUIREMENT/UNIT_WORK_DESIGN/SCREEN_IMPL만 값이 있음(완료/진행중/지연 배지 색 계산용).
   * PHASE/MILESTONE/HOLIDAY는 진척률 개념이 없어 항상 null(고정 색으로 표시).
   */
  progress: number | null;
  /** 본인 담당 여부 — "내 담당만" 필터용. 담당자 개념이 없는 카테고리는 항상 null(필터와 무관하게 항상 표시) */
  isMine: boolean | null;
};

export type CalendarResponse = {
  /** 조회 범위 시작 (YYYY-MM-01) — echo */
  monthStart: string;
  /** 조회 범위 끝 (YYYY-MM-말일) — echo */
  monthEnd:   string;
  /** 해당 월 안에 날짜가 떨어지는 이벤트 전부 (카테고리 무관, 클라이언트에서 필터) */
  events: CalendarEvent[];
};
