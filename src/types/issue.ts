/**
 * 협조 및 이슈사항 타입 — 클라이언트/서버 공유
 *
 * 주 단위 스냅샷이 아니라 프로젝트가 계속 관리하는 살아있는 목록 (TbWrIssue 1:1 매핑).
 * 리더 리포트 인쇄 미리보기의 "협조 및 이슈사항 현황" 표에 그대로 사용된다.
 */

// CUSTOMER_REQ(고객요청) / OUR_REQ(당사요청) — 방향이 있는 협조요청, ISSUE — 방향이 없는 일반 이슈
export type IssueCategoryCode = "CUSTOMER_REQ" | "OUR_REQ" | "ISSUE";

export type IssueStatusCode = "OPEN" | "IN_PROGRESS" | "PARTIAL" | "DONE";

export type Issue = {
  issueId:      string;
  categoryCode: IssueCategoryCode;
  cn:           string;
  actionCn:     string | null;
  requesterNm:  string | null;
  assigneeNm:   string | null;
  /** YYYY-MM-DD */
  reqDt:        string | null;
  /** YYYY-MM-DD — 목표(예정)일 */
  dueDt:        string | null;
  statusCode:   IssueStatusCode;
  /** Y/N — 인쇄 미리보기(고객 보고용)에 노출할지. 목록 자체는 그대로 관리하고 노출만 뺄 수 있음 */
  rptYn:        "Y" | "N";
  sortOrdr:     number;
};

export type IssueListResponse = {
  items: Issue[];
};

export const ISSUE_CATEGORY_LABEL: Record<IssueCategoryCode, string> = {
  CUSTOMER_REQ: "고객요청",
  OUR_REQ:      "당사요청",
  ISSUE:        "이슈",
};

export const ISSUE_STATUS_LABEL: Record<IssueStatusCode, string> = {
  OPEN:        "대기",
  IN_PROGRESS: "진행중",
  PARTIAL:     "부분완료",
  DONE:        "완료",
};
