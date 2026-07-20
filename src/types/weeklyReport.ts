/**
 * 주간보고 타입 — 클라이언트/서버 공유
 *
 * 격리 원칙:
 *   - workLog.ts 와 독립 (weekly-reports 는 work-logs 를 원본으로 참조만 함)
 *   - "PM 전용 AI 주간보고 초안" 컨셉 — TbWrWeeklyReport 1:1 매핑
 *
 * 생성 흐름:
 *   POST 로 생성 요청 → TbAiTask PENDING 생성 → (누군가 /run-ai-tasks 실행) →
 *   draft_cn 반영 → GET 폴링으로 완료 확인. aiTaskStatus 가 이 흐름의 진행 상태.
 */

export type AiTaskStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "FAILED" | null;

export type WeeklyReport = {
  weeklyReportId: string;
  /** YYYY-MM-DD — 그 주 월요일 */
  weekStartDt:    string;
  draftCn:        string | null;
  aiTaskId:       string | null;
  /** 마지막으로 연결된 AI 태스크의 처리 상태 — null 이면 아직 생성 요청 안 함 */
  aiTaskStatus:   AiTaskStatus;
  creatMberId:    string;
  creatMberNm:    string | null;
  creatDt:        string;
  mdfcnDt:        string | null;
};

export type WeeklyReportListResponse = {
  items: WeeklyReport[];
};
