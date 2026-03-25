/**
 * layout.ts — 레이아웃 관련 공통 타입
 */

// 테마 — data-theme 속성값과 일치해야 함
export type Theme = "dark" | "light" | "dark-purple";

// GNB 프로젝트 셀렉터용
export type ProjectOption = {
  prjct_id: string;
  prjct_nm: string;
  role_code: string;
};

// 상태바 이벤트 피드
export type RecentEvent = {
  id:        string;
  actor_nm:  string;
  content:   string;
  event_dt:  string; // ISO string
};

// 상태바 AI 지표
export type StatusSummary = {
  unsyncedChanges: number; // ai_req_yn = 'N' 건수
  aiStats: {
    pending:    number;
    inProgress: number;
    done:       number;
  };
};
