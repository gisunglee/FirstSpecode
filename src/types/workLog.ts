/**
 * 업무일지 타입 — 클라이언트/서버 공유
 *
 * 격리 원칙:
 *   - pm.ts, dashboard.ts, focus.ts 등과 독립
 *   - "개인/팀 일일·주간 업무 기록" 컨셉 — TbWrWorkLog(+items) 1:1 매핑
 */

// 일감 연결 대상 — 오늘 할일 항목에 기존 스펙 엔티티를 선택적으로 연결할 때 사용
export type WorkLogItemRefType = "UNIT_WORK" | "SCREEN" | "FUNCTION" | "TASK";

export type WorkLogItem = {
  itemId:     string;
  itemCn:     string;
  refTyCode:  WorkLogItemRefType | null;
  refId:      string | null;
  doneYn:     "Y" | "N";
  sortOrdr:   number;
};

// DAILY = 하루 일지, WEEK = 그 주(월요일 기준) 계획
export type WorkLogTypeCode = "DAILY" | "WEEK";

export type WorkLog = {
  workLogId:   string;
  mberId:      string;
  mberNm:      string | null;
  logTyCode:   WorkLogTypeCode;
  /** YYYY-MM-DD — DAILY는 해당일, WEEK는 그 주 월요일 */
  logDt:       string;
  /** DAILY: 오늘 작업 결과, WEEK: 이번주 계획 */
  noteCn:      string | null;
  /** WEEK 전용(이번주 결과) — DAILY는 항상 null */
  resultCn:    string | null;
  items:       WorkLogItem[];
  creatDt:     string;
  mdfcnDt:     string | null;
};

// GET /api/projects/[id]/work-logs?date=... 또는 ?from=&to=... 공통 응답
export type WorkLogResponse = {
  items: WorkLog[];
};
