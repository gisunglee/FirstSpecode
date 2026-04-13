/**
 * planStudio — 기획실 코드값 상수 (v2)
 *
 * 역할:
 *   - 기획 구분(DIV), 산출물 형식(FMT), 컨텍스트 타입(CTXT) 앱 전체 공용 상수
 *   - API/프론트 모두에서 import하여 동일 값 사용
 *
 * v2 구조:
 *   - 기획실(plan_studio) = 폴더(컨테이너)
 *   - 산출물(artf) = 실제 작업 단위 (기획명, 구분, 형식, 컨텍스트 포함)
 *   - 컨텍스트는 artf 레벨에 매핑
 */

/** 기획 구분 (artf_div_code) — 산출물 레벨 */
export const ARTF_DIV = {
  IA:      { code: "IA",      name: "정보구조도",   group: "기획" },
  JOURNEY: { code: "JOURNEY", name: "사용자여정",   group: "기획" },
  FLOW:    { code: "FLOW",    name: "화면흐름",     group: "기획" },
  MOCKUP:  { code: "MOCKUP",  name: "목업",         group: "기획" },
  ERD:     { code: "ERD",     name: "ERD",          group: "개발" },
  PROCESS: { code: "PROCESS", name: "업무프로세스", group: "개발" },
} as const;

/** 산출물 형식 (artf_fmt_code) — 택 1 */
export const ARTF_FMT = {
  MD:      { code: "MD",      name: "마크다운" },
  MERMAID: { code: "MERMAID", name: "Mermaid" },
  HTML:    { code: "HTML",    name: "HTML" },
} as const;

/** 컨텍스트 유형 (ctxt_ty_code) */
export const CTXT_TY = {
  REQ:    { code: "REQ",    name: "요구사항" },
  ARTF:   { code: "ARTF",   name: "기획보드" },   // 다른 산출물 참조
  UNIT:   { code: "UNIT",   name: "단위업무" },   // 향후
  SCREEN: { code: "SCREEN", name: "화면설계" },   // 향후
} as const;

/** AI 태스크 ref_ty_code — 산출물 단위 */
export const AI_TASK_REF_TY_ARTF = "PLAN_STUDIO_ARTF";

/** AI 태스크 task_ty_code — 산출물 생성 */
export const AI_TASK_TY_ARTF_GENERATE = "PLAN_STUDIO_ARTF_GENERATE";

/** 구분 코드 → 배지 색상 (프론트 전용) */
export const DIV_BADGE_COLOR: Record<string, { bg: string; color: string }> = {
  IA:      { bg: "#e3f2fd", color: "#1565c0" },
  JOURNEY: { bg: "#e8f5e9", color: "#2e7d32" },
  FLOW:    { bg: "#fff3e0", color: "#e65100" },
  MOCKUP:  { bg: "#fce4ec", color: "#c62828" },
  ERD:     { bg: "#ede7f6", color: "#4527a0" },
  PROCESS: { bg: "#e0f2f1", color: "#00695c" },
};

/** AI 상태 → 배지 */
export const AI_STATUS_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  PENDING:     { bg: "#fff3e0", color: "#e65100", label: "대기" },
  IN_PROGRESS: { bg: "#e3f2fd", color: "#1565c0", label: "작업중" },
  PROCESSING:  { bg: "#e3f2fd", color: "#1565c0", label: "작업중" },
  COMPLETED:   { bg: "#e8f5e9", color: "#2e7d32", label: "생성완료" },
  DONE:        { bg: "#e8f5e9", color: "#2e7d32", label: "생성완료" },
  APPLIED:     { bg: "#e8f5e9", color: "#1b5e20", label: "반영됨" },
  REJECTED:    { bg: "#f5f5f5", color: "#757575", label: "반려" },
  FAILED:      { bg: "#fce4ec", color: "#c62828", label: "실패" },
  TIMEOUT:     { bg: "#fce4ec", color: "#c62828", label: "시간초과" },
};
