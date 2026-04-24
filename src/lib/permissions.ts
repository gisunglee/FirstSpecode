/**
 * permissions — SPECODE 권한 매트릭스 (단일 진실 소스)
 *
 * 역할:
 *   - 모든 권한 규칙을 한 파일에서 관리 (역할 OR 직무 OR 조건)
 *   - 백엔드(requirePermission) / 프론트(usePermissions) 양쪽에서 동일하게 참조
 *
 * 설계 문서:
 *   src/lib/permissions.md  ← 반드시 함께 읽을 것
 *
 * 4가지 축:
 *   - 역할(Role)  : 프로젝트 단위 보안 게이트 (OWNER/ADMIN/MEMBER/VIEWER)
 *   - 직무(Job)   : 프로젝트 단위 업무 성격 (PM/PL/DBA/DEV/DESIGNER/QA/ETC)
 *   - 플랜(Plan)  : 계정 단위 결제 (FREE/PRO/TEAM/ENTERPRISE)
 *   - 규칙 결합   : roles OR jobs (둘 중 하나라도 만족하면 허용)
 */

// ─── 역할 ────────────────────────────────────────────────────────────────────

export const ROLE_CODES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;
export type  RoleCode   = (typeof ROLE_CODES)[number];

export const ROLE_LABEL: Record<RoleCode, string> = {
  OWNER:  "소유자",
  ADMIN:  "관리자",
  MEMBER: "멤버",
  VIEWER: "뷰어",
};

// ─── 직무 ────────────────────────────────────────────────────────────────────

export const JOB_CODES = ["PM", "PL", "DBA", "DEV", "DESIGNER", "QA", "ETC"] as const;
export type  JobCode   = (typeof JOB_CODES)[number];

export const JOB_LABEL: Record<JobCode, string> = {
  PM:       "프로젝트 매니저",
  PL:       "프로젝트 리더",
  DBA:      "DB 관리자",
  DEV:      "개발자",
  DESIGNER: "디자이너",
  QA:       "품질·테스트",
  ETC:      "미지정",
};

// ─── 시스템 역할 (SaaS 플랫폼 전체 관리자) ────────────────────────────────
//
// "관리자(ADMIN)" 는 프로젝트 단위 역할 — 해당 프로젝트 안에서만 유효.
// SYSTEM_ROLE 은 SaaS 플랫폼 자체의 전역 역할 — 모든 프로젝트·사용자에
// 대한 관리 권한을 별도의 컬럼(tb_cm_member.sys_role_code)에서 관리한다.
//
// DB UPDATE 로만 설정. UI/API 로는 바꿀 수 없다 (권한 연쇄 상승 차단).
export const SYSTEM_ROLE_CODES = ["SUPER_ADMIN"] as const;
export type  SystemRoleCode    = (typeof SYSTEM_ROLE_CODES)[number];

export const SYSTEM_ROLE_LABEL: Record<SystemRoleCode, string> = {
  SUPER_ADMIN: "시스템 관리자",
};

// ─── 플랜 ────────────────────────────────────────────────────────────────────

export const PLAN_CODES = ["FREE", "PRO", "TEAM", "ENTERPRISE"] as const;
export type  PlanCode   = (typeof PLAN_CODES)[number];

// 플랜 계층 — 숫자가 클수록 상위 (requiresPlan 비교에 사용)
const PLAN_RANK: Record<PlanCode, number> = {
  FREE:       0,
  PRO:        1,
  TEAM:       2,
  ENTERPRISE: 3,
};

// ─── 권한 규칙 정의 ──────────────────────────────────────────────────────────

export type PermissionRule = {
  roles?:        readonly RoleCode[];  // 허용 역할 (비어있으면 역할 조건 없음)
  jobs?:         readonly JobCode[];   // 허용 직무 (비어있으면 직무 조건 없음)
  requiresPlan?: PlanCode;             // 이 플랜 이상 필요 (FREE=전체, PRO=유료만)
};

/**
 * 권한 매트릭스 — "액션 → 허용 조건" 맵
 *
 * 규칙: roles OR jobs (둘 중 하나라도 만족하면 허용)
 *       + requiresPlan 있으면 플랜 조건도 AND
 *
 * 새 권한을 추가할 땐 여기만 수정하면 됨.
 */
export const PERMISSIONS = {
  // ── 프로젝트 ────────────────────────────────────────────────────
  "project.read":       { roles: ["OWNER", "ADMIN", "MEMBER", "VIEWER"] },
  "project.settings":   { roles: ["OWNER", "ADMIN"] },
  "project.update":     { roles: ["OWNER", "ADMIN"] },
  "project.delete":     { roles: ["OWNER"] },
  "project.transfer":   { roles: ["OWNER"] },

  // ── 멤버 관리 ────────────────────────────────────────────────────
  "member.read":        { roles: ["OWNER", "ADMIN", "MEMBER", "VIEWER"] },
  "member.invite":      { roles: ["OWNER", "ADMIN"] },
  "member.remove":      { roles: ["OWNER", "ADMIN"] },
  "member.changeRole":  { roles: ["OWNER", "ADMIN"] },  // OWNER 승격은 호출부에서 별도 체크
  "member.changeJob":   { roles: ["OWNER", "ADMIN"] },

  // ── 일반 콘텐츠 (과업/요구사항/스토리/화면/영역/기능/단위업무/메모 등) ──
  "content.read":       { roles: ["OWNER", "ADMIN", "MEMBER", "VIEWER"] },
  "content.create":     { roles: ["OWNER", "ADMIN", "MEMBER"] },
  "content.update":     { roles: ["OWNER", "ADMIN", "MEMBER"] },
  "content.delete":     { roles: ["OWNER", "ADMIN", "MEMBER"] },

  // ── DB 표준 (DBA 직무가 ADMIN 없이도 다룰 수 있는 혼합 예시) ──────
  // db.table.write: 스키마 수정 — OWNER/ADMIN 또는 DBA/DEV 직무 (개발 단계 유연성)
  // db.standard.manage: DB 표준 관리 — OWNER/ADMIN 또는 DBA 직무만 (더 엄격)
  "db.table.write":     { roles: ["OWNER", "ADMIN"], jobs: ["DBA", "DEV"] },
  "db.standard.manage": { roles: ["OWNER", "ADMIN"], jobs: ["DBA"] },

  // ── AI ─────────────────────────────────────────────────────────
  "ai.request":         { roles: ["OWNER", "ADMIN", "MEMBER"] },
  "ai.bulkDesign":      { roles: ["OWNER", "ADMIN", "MEMBER"], requiresPlan: "PRO" },
  "ai.planStudio":      { roles: ["OWNER", "ADMIN", "MEMBER"], requiresPlan: "PRO" },

  // ── 환경설정 / API 키 ────────────────────────────────────────────
  // config.manage: 환경설정 — OWNER/ADMIN 또는 PM/PL 직무 (기획·리딩 업무에서 필요)
  // apiKey.manage: 외부 AI 공급자 키(OpenAI/Anthropic 등) — OWNER/ADMIN 전용
  "config.manage":      { roles: ["OWNER", "ADMIN"], jobs: ["PM", "PL"] },
  "apiKey.manage":      { roles: ["OWNER", "ADMIN"] },

  // ── 공통코드 / 기준 정보 ─────────────────────────────────────────
  "code.read":          { roles: ["OWNER", "ADMIN", "MEMBER", "VIEWER"] },
  "code.write":         { roles: ["OWNER", "ADMIN"] },
} as const satisfies Record<string, PermissionRule>;

export type Permission = keyof typeof PERMISSIONS;

// ─── 체크 함수 ───────────────────────────────────────────────────────────────

export type ActorContext = {
  role: RoleCode | null;              // 프로젝트 멤버가 아니면 null
  job:  JobCode  | null;              // 직무 미지정 시 'ETC'
  plan: PlanCode;                     // 계정 플랜 (기본 FREE)
  systemRole?: SystemRoleCode | null; // 시스템 역할 (일반 사용자는 null)
};

/**
 * 단일 권한 체크 — 역할 OR 직무 OR (플랜 조건)
 *
 * 반환값:
 *   true  : 허용
 *   false : 거부 (이유는 explainPermission 으로 확인 가능)
 *
 * 시스템 관리자 short-circuit:
 *   systemRole === "SUPER_ADMIN" 이면 프로젝트 역할·직무·플랜 조건을 무시하고
 *   모든 권한을 허용한다. 단, "지원 세션"(다른 사람 프로젝트 읽기 전용 진입)
 *   상태에서는 requirePermission 이 systemRole 을 비워서 넘기므로 이 분기는
 *   타지 않는다 — 그때는 role=VIEWER 로 일반 규칙대로 동작한다.
 */
export function hasPermission(actor: ActorContext, permission: Permission): boolean {
  // 시스템 관리자는 전역 허용 — 플랜 제약(ai.bulkDesign 등)까지 우회
  // (플랫폼 운영자 본인의 권한이지 고객 계정 기능이 아니므로)
  if (actor.systemRole === "SUPER_ADMIN") return true;

  // as PermissionRule — satisfies 로 체크된 값을 optional 속성 포함 형태로 접근
  const rule = PERMISSIONS[permission] as PermissionRule;

  // 역할 조건 만족?
  const roleOK = rule.roles && actor.role
    ? (rule.roles as readonly RoleCode[]).includes(actor.role)
    : false;

  // 직무 조건 만족?
  const jobOK = rule.jobs && actor.job
    ? (rule.jobs as readonly JobCode[]).includes(actor.job)
    : false;

  // 역할·직무 중 하나라도 만족해야 함 (OR)
  if (!roleOK && !jobOK) return false;

  // 플랜 조건 추가 확인 (requiresPlan 있는 경우)
  if (rule.requiresPlan) {
    const required = PLAN_RANK[rule.requiresPlan];
    const current  = PLAN_RANK[actor.plan];
    if (current < required) return false;
  }

  return true;
}

/**
 * 거부 사유 설명 — 에러 메시지·로깅용
 *
 * 반환값:
 *   null : 허용됨
 *   { code, message } : 거부 사유
 */
export function explainPermission(
  actor: ActorContext,
  permission: Permission
): { code: "FORBIDDEN_ROLE" | "FORBIDDEN_PLAN"; message: string } | null {
  const rule = PERMISSIONS[permission] as PermissionRule;

  const roleOK = rule.roles && actor.role
    ? (rule.roles as readonly RoleCode[]).includes(actor.role) : false;
  const jobOK  = rule.jobs  && actor.job
    ? (rule.jobs  as readonly JobCode[]).includes(actor.job)  : false;

  if (!roleOK && !jobOK) {
    return {
      code:    "FORBIDDEN_ROLE",
      message: "이 작업을 수행할 권한이 없습니다.",
    };
  }

  if (rule.requiresPlan && PLAN_RANK[actor.plan] < PLAN_RANK[rule.requiresPlan]) {
    return {
      code:    "FORBIDDEN_PLAN",
      message: `${rule.requiresPlan} 이상 플랜이 필요합니다.`,
    };
  }

  return null;
}

/**
 * 여러 권한 한꺼번에 체크 — 프론트에서 메뉴·버튼 일괄 필터링용
 */
export function checkPermissions(
  actor: ActorContext,
  permissions: readonly Permission[]
): Record<Permission, boolean> {
  const result = {} as Record<Permission, boolean>;
  for (const p of permissions) result[p] = hasPermission(actor, p);
  return result;
}

// ─── 입력값 검증 유틸 ─────────────────────────────────────────────────────────

export function isRoleCode(v: unknown): v is RoleCode {
  return typeof v === "string" && (ROLE_CODES as readonly string[]).includes(v);
}
export function isJobCode(v: unknown): v is JobCode {
  return typeof v === "string" && (JOB_CODES as readonly string[]).includes(v);
}
export function isPlanCode(v: unknown): v is PlanCode {
  return typeof v === "string" && (PLAN_CODES as readonly string[]).includes(v);
}
export function isSystemRoleCode(v: unknown): v is SystemRoleCode {
  return typeof v === "string" && (SYSTEM_ROLE_CODES as readonly string[]).includes(v);
}
