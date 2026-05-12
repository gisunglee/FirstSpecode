/**
 * 캘린더 타입 — 클라이언트/서버 공유
 *
 * 격리 원칙:
 *   - 다른 대시보드 타입과 독립
 *   - "단위업무 종료일을 달력에 배치" 가 1차 MVP 의 유일한 사용처
 */

// ── 단위업무 이벤트 (종료일 기준 배치) ─────────────────────────────────────
export type CalendarUnitWork = {
  unitWorkId:   string;
  displayId:    string;
  name:         string;
  /** 종료일 (YYYY-MM-DD) — null 인 단위업무는 캘린더에 표시되지 않음 */
  endDate:      string;
  /** 진행률 0~100 — 색상 결정에 사용 */
  progress:     number;
  /** 담당자 표시명 (mber_nm / email_addr fallback). 미지정·퇴장 멤버는 null */
  assigneeName: string | null;
  /** 본인 담당 여부 — 클라이언트에서 "내 단위업무만" 필터에 사용 */
  isMine:       boolean;
};

export type CalendarResponse = {
  /** 조회 범위 시작 (YYYY-MM-01) — echo */
  monthStart: string;
  /** 조회 범위 끝 (YYYY-MM-말일) — echo */
  monthEnd:   string;
  /** 해당 월 안에 endDate 가 떨어진 단위업무들 */
  items: CalendarUnitWork[];
};
