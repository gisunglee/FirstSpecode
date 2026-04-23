/**
 * codes.ts — 시스템 공통코드 (v1)
 *
 * 역할:
 *   - 시스템 내부에서 "고정된" 상태·타입 값의 TypeScript union + 라벨/색상 매핑을 한 곳에서 관리
 *   - 파일 간 라벨 불일치(예: APPLIED="반영됨" vs "적용됨")를 원천 차단
 *   - TS union 타입을 활용해 switch/Record 누락을 컴파일 타임에 감지
 *
 * 원칙:
 *   - **값 리터럴은 DB 실제 값과 일치** (예: `"APPLIED"` 그대로 — 이 문자열을 바꾸면 DB/API가 망가진다)
 *   - 라벨·색상만 이 파일에서 결정
 *   - 도메인이 다르면 타입을 분리 (AiTaskStatus ≠ InvitationStatus)
 *   - Plan Studio 기획실 도메인은 `constants/planStudio.ts`에 별도 유지 (기획실 전용 값·색상이 다름)
 *
 * 사용 예:
 *   import { type AiTaskStatus, AI_TASK_STATUS_LABEL, AI_TASK_STATUS_BADGE } from "@/constants/codes";
 *
 *   const status: AiTaskStatus = "PENDING";
 *   <span>{AI_TASK_STATUS_LABEL[status]}</span>
 *   <span style={{
 *     background: AI_TASK_STATUS_BADGE[status].bg,
 *     color:      AI_TASK_STATUS_BADGE[status].fg,
 *   }}>{AI_TASK_STATUS_LABEL[status]}</span>
 */

// ══════════════════════════════════════════════════════════════════════════════
// AI 태스크 — tb_ai_task
// ══════════════════════════════════════════════════════════════════════════════

// ── 상태 (task_sttus_code) ───────────────────────────────────────────────────

export type AiTaskStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "DONE"
  | "APPLIED"
  | "REJECTED"
  | "FAILED"
  | "TIMEOUT";

export const AI_TASK_STATUS_LABEL: Record<AiTaskStatus, string> = {
  PENDING:     "대기",
  IN_PROGRESS: "처리중",
  DONE:        "완료",
  APPLIED:     "반영됨",
  REJECTED:    "반려",
  FAILED:      "실패",
  TIMEOUT:     "시간초과",
};

/**
 * 배지 스타일 (bg + fg) — 목록 행·다이얼로그 상태 배지에 사용
 * 13개 파일에 중복되어 있던 배지 색상을 단일화한 것
 */
export const AI_TASK_STATUS_BADGE: Record<AiTaskStatus, { bg: string; fg: string }> = {
  PENDING:     { bg: "#f5f5f5", fg: "#666666" },
  IN_PROGRESS: { bg: "#e3f2fd", fg: "#1565c0" },
  DONE:        { bg: "#e8f5e9", fg: "#2e7d32" },
  APPLIED:     { bg: "#e8eaf6", fg: "#283593" },
  REJECTED:    { bg: "#fff3e0", fg: "#e65100" },
  FAILED:      { bg: "#ffebee", fg: "#c62828" },
  TIMEOUT:     { bg: "#fff3e0", fg: "#e65100" },
};

/**
 * 도트 스타일 (단색) — 상세 페이지 AI 카드의 작은 원 배지에 사용
 * AiImplementCard·상세 페이지들에 중복되어 있던 단색 팔레트
 */
export const AI_TASK_STATUS_DOT: Record<AiTaskStatus, string> = {
  PENDING:     "#f57c00",
  IN_PROGRESS: "#1565c0",
  DONE:        "#2e7d32",
  APPLIED:     "#6a1b9a",
  REJECTED:    "#c62828",
  FAILED:      "#c62828",
  TIMEOUT:     "#757575",
};

// ── 태스크 타입 (task_ty_code) ───────────────────────────────────────────────
//
// NOTE: `tb_ai_task.task_ty_code` 컬럼은 물리적으로 하나지만, 논리적으로는 두 도메인의 값이 섞여 들어간다.
//   (1) 본 AiTaskType — 일반 AI 작업 (설계/검토/구현 등)
//   (2) Plan Studio `ARTF_DIV` — 기획실 산출물 생성 (IA/JOURNEY/ERD 등)
// UI에서 "전체 task_ty_code 옵션"이 필요하면 두 상수를 합쳐 사용한다 (ai-tasks 목록 필터 참고).
// 타입은 분리 유지 — 각 도메인에서 자기 서브셋만 다루게 해서 실수 방지.

export type AiTaskType =
  | "INSPECT"
  | "DESIGN"
  | "IMPLEMENT"
  | "MOCKUP"
  | "IMPACT"
  | "CUSTOM"
  | "PRE_IMPL";

export const AI_TASK_TYPE_LABEL: Record<AiTaskType, string> = {
  INSPECT:   "명세 검토",
  DESIGN:    "설계",
  IMPLEMENT: "구현",
  MOCKUP:    "목업",
  IMPACT:    "영향도 분석",
  CUSTOM:    "자유 요청",
  PRE_IMPL:  "선 구현",
};

// ── 참조 엔티티 타입 (ref_ty_code) ───────────────────────────────────────────

export type AiRefType =
  | "UNIT_WORK"
  | "SCREEN"
  | "AREA"
  | "FUNCTION"
  | "PLAN_STUDIO_ARTF";

export const AI_REF_TYPE_LABEL: Record<AiRefType, string> = {
  UNIT_WORK:        "단위업무",
  SCREEN:           "화면",
  AREA:             "영역",
  FUNCTION:         "기능",
  PLAN_STUDIO_ARTF: "기획실 산출물",
};

// ══════════════════════════════════════════════════════════════════════════════
// 프롬프트 템플릿 — tb_ai_prompt_template
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 프롬프트 템플릿이 적용되는 태스크 타입 — AI 태스크 타입 + 템플릿 전용 "TEST"
 * `TEST` 는 실제 AI 태스크로 실행되지 않고, 프롬프트 작성 과정에서 테스트 실행용으로만 사용되는 코드.
 */
export type PromptTemplateTaskType = AiTaskType | "TEST";

export const PROMPT_TEMPLATE_TASK_TYPE_LABEL: Record<PromptTemplateTaskType, string> = {
  ...AI_TASK_TYPE_LABEL,
  TEST: "테스트",
};

/**
 * 프롬프트 템플릿이 적용되는 참조 엔티티 — PLAN_STUDIO_ARTF 를 제외한 설계 도메인 엔티티만
 * (기획실 산출물 프롬프트는 `constants/planStudio.ts` 의 AI_TASK_TY_ARTF_GENERATE 경로에서 관리)
 */
export type PromptTemplateRefType = Exclude<AiRefType, "PLAN_STUDIO_ARTF">;

export const PROMPT_TEMPLATE_REF_TYPE_LABEL: Record<PromptTemplateRefType, string> = {
  UNIT_WORK: "단위업무",
  SCREEN:    "화면",
  AREA:      "영역",
  FUNCTION:  "기능",
};

// ══════════════════════════════════════════════════════════════════════════════
// 표준 가이드 — tb_sg_std_guide (UW-00030)
// ══════════════════════════════════════════════════════════════════════════════

// ── 카테고리 (guide_ctgry_code) ──────────────────────────────────────────────
//
// DB 컬럼값을 그대로 사용 — 문자열 바꾸면 기존 데이터가 "알 수 없는 카테고리"가 된다.
// 카테고리 마스터 테이블 없이 enum으로 관리 (MVP) — 추후 UW-00031에서 확장.

export type GuideCategory =
  | "UI"
  | "DATA"
  | "AUTH"
  | "API"
  | "COMMON"
  | "SECURITY"
  | "FILE"
  | "ERROR"
  | "BATCH"
  | "REPORT";

/** 서버 사이드 유효성 검증과 탭/select 옵션 양쪽에서 사용 */
export const GUIDE_CATEGORIES: readonly GuideCategory[] = [
  "UI", "DATA", "AUTH", "API", "COMMON", "SECURITY", "FILE", "ERROR", "BATCH", "REPORT",
] as const;

export const GUIDE_CATEGORY_LABEL: Record<GuideCategory, string> = {
  UI:       "UI 가이드",
  DATA:     "데이터 모델",
  AUTH:     "인증",
  API:      "API 명세",
  COMMON:   "공통 규칙",
  SECURITY: "보안 정책",
  FILE:     "파일 처리",
  ERROR:    "에러 처리",
  BATCH:    "배치",
  REPORT:   "리포트",
};

/**
 * 카테고리 배지 색상 — 목록 행과 상세 배지에 공통 사용
 * 기존 AI_TASK_STATUS_BADGE 와 동일 포맷(bg+fg)으로 유지
 */
export const GUIDE_CATEGORY_BADGE: Record<GuideCategory, { bg: string; fg: string }> = {
  UI:       { bg: "#e3f2fd", fg: "#1565c0" },  // 파랑
  DATA:     { bg: "#fff8e1", fg: "#f57f17" },  // 앰버
  AUTH:     { bg: "#f3e5f5", fg: "#6a1b9a" },  // 보라
  API:      { bg: "#e0f2f1", fg: "#00695c" },  // 틸
  COMMON:   { bg: "#eceff1", fg: "#455a64" },  // 회색
  SECURITY: { bg: "#fff3e0", fg: "#e65100" },  // 주황
  FILE:     { bg: "#e8f5e9", fg: "#2e7d32" },  // 녹색
  ERROR:    { bg: "#ffebee", fg: "#c62828" },  // 빨강
  BATCH:    { bg: "#e8eaf6", fg: "#283593" },  // 인디고
  REPORT:   { bg: "#fce4ec", fg: "#ad1457" },  // 핑크
};

/** 런타임 검증 — 외부 입력(API body, query)이 유효한 카테고리인지 체크 */
export function isGuideCategory(value: unknown): value is GuideCategory {
  return typeof value === "string" && (GUIDE_CATEGORIES as readonly string[]).includes(value);
}

// ══════════════════════════════════════════════════════════════════════════════
// 멤버 초대 — tb_pj_project_invitation
// ══════════════════════════════════════════════════════════════════════════════

export type InvitationStatus = "PENDING" | "ACCEPTED" | "EXPIRED" | "CANCELLED";

export const INVITATION_STATUS_LABEL: Record<InvitationStatus, string> = {
  PENDING:   "대기중",
  ACCEPTED:  "수락",
  EXPIRED:   "만료",
  CANCELLED: "취소",
};

/**
 * 초대 상태 색상 — 기존 invitations 페이지가 CSS 변수를 그대로 사용하므로 같은 형식 유지
 * 배지용이 아니라 단색(브랜드/성공/tertiary)이므로 AI_TASK_STATUS_DOT 와 다른 형태.
 */
export const INVITATION_STATUS_COLOR: Record<InvitationStatus, string> = {
  PENDING:   "var(--color-brand)",
  ACCEPTED:  "var(--color-success, #22c55e)",
  EXPIRED:   "var(--color-text-tertiary)",
  // CANCELLED 는 "취소 당함"을 강조하기 위해 error 색상 사용 (기존 invitations 페이지 규칙)
  CANCELLED: "var(--color-error)",
};
