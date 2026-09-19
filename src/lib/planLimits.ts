/**
 * planLimits — 플랜 상한 검사 (FREE 브레이크)
 *
 * 역할:
 *   - FREE 플랜의 상한 3가지를 API 진입점에서 한 줄로 검사한다.
 *       ① 소유 프로젝트 수      → 프로젝트 생성·복사
 *       ② 프로젝트당 멤버 수    → 멤버 초대·초대 수락
 *       ③ 첨부파일 업로드 차단  → 첨부 업로드 라우트
 *   - 판정 기준은 **프로젝트 소유자의 플랜**이다 (행위자의 플랜이 아님).
 *     소유자가 유료면 그 프로젝트 멤버 전원이 유료 혜택을 받는다.
 *
 * 왜 이 3곳만 세는가:
 *   - 정책 문서 §1-10 — "상한 계산은 3곳만. 일상 요청은 아무것도 세지 않는다."
 *   - 상한은 "새로 늘리는 것"만 막는다. 이미 상한을 넘겨 쓰고 있던 기존 사용자의
 *     프로젝트·멤버는 그대로 두고 추가만 막힌다 (정책 §1-6).
 *
 * 유료 플랜(BASIC/PRO/ENTERPRISE)의 좌석 상한은 구독 테이블이 생기는 2단계에서
 * 이 파일에 추가한다. 지금은 유료 플랜이면 무제한으로 통과시킨다.
 *
 * 시스템 관리자(SUPER_ADMIN)는 플랫폼 운영자 본인이므로 상한을 적용하지 않는다
 * (hasPermission 의 SUPER_ADMIN short-circuit 과 같은 이유).
 *
 * 정책 근거: .claude/biz/B.결제정책.md §1-2 티어, §1-3 소유자 기준, §1-8 첨부, §3 3단계
 */

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/apiResponse";
import { resolveEffectivePlan, type PlanCode } from "@/lib/permissions";

// ─── FREE 상한 값 (요금제 페이지 siteInfo.PRICING 과 반드시 같아야 함) ─────────
export const FREE_LIMITS = {
  /** 소유(OWNER) 가능한 활성 프로젝트 수 */
  ownedProjects: 1,
  /** 프로젝트당 멤버 수 — 소유자·뷰어 포함 전원 */
  membersPerProject: 5,
} as const;

// 에러 코드 — 프론트가 이 코드를 보고 "요금제 안내 모달"을 띄운다
export const PLAN_LIMIT_CODES = {
  project: "PLAN_LIMIT_PROJECT",
  member:  "PLAN_LIMIT_MEMBER",
  upload:  "PLAN_LIMIT_UPLOAD",
} as const;

/** 요금제 안내 경로 — 에러 응답 extra 에 실어 프론트가 링크로 쓴다 */
export const PRICING_PATH = "/intro/pricing";

// ─── 플랜 조회 ────────────────────────────────────────────────────────────────

/**
 * 회원의 실효 플랜. 시스템 관리자는 ENTERPRISE 로 취급(상한 없음).
 * 회원이 없으면 FREE (가장 보수적인 값).
 */
export async function getMemberEffectivePlan(mberId: string): Promise<PlanCode> {
  const member = await prisma.tbCmMember.findUnique({
    where:  { mber_id: mberId },
    select: { plan_code: true, plan_expire_dt: true, sys_role_code: true },
  });
  if (!member) return "FREE";
  if (member.sys_role_code === "SUPER_ADMIN") return "ENTERPRISE";
  return resolveEffectivePlan(member.plan_code, member.plan_expire_dt);
}

/**
 * 프로젝트 소유자의 실효 플랜. 프로젝트가 없으면 null.
 * 소유자는 tb_pj_project.owner_mber_id 단일 컬럼만 본다 (정책 §1-3).
 */
export async function getProjectOwnerPlan(
  projectId: string
): Promise<{ ownerMberId: string; plan: PlanCode } | null> {
  const project = await prisma.tbPjProject.findUnique({
    where:  { prjct_id: projectId },
    select: { owner_mber_id: true },
  });
  if (!project) return null;
  const plan = await getMemberEffectivePlan(project.owner_mber_id);
  return { ownerMberId: project.owner_mber_id, plan };
}

// ─── 상한 검사 ────────────────────────────────────────────────────────────────
// 반환값: 통과하면 null, 막히면 403 Response (호출부는 `if (err) return err;`)

/**
 * ① 소유 프로젝트 수 — 프로젝트 생성·복사 전에 호출.
 * 삭제 대기(del_yn='Y') 프로젝트는 세지 않는다 — 복구되면 그때 상한을 넘긴 상태가
 * 될 수 있지만, 그 처리는 잠금(3단계 후반) 의 몫이다.
 */
export async function checkOwnedProjectLimit(mberId: string): Promise<Response | null> {
  const plan = await getMemberEffectivePlan(mberId);
  if (plan !== "FREE") return null;

  const owned = await prisma.tbPjProject.count({
    where: { owner_mber_id: mberId, del_yn: "N" },
  });
  if (owned < FREE_LIMITS.ownedProjects) return null;

  return apiError(
    PLAN_LIMIT_CODES.project,
    `FREE 플랜은 프로젝트를 ${FREE_LIMITS.ownedProjects}개까지 소유할 수 있습니다. ` +
      "더 만들려면 BASIC 플랜이 필요합니다.",
    403,
    { plan, limit: FREE_LIMITS.ownedProjects, current: owned, pricingPath: PRICING_PATH }
  );
}

/**
 * ② 프로젝트당 멤버 수 — 초대 발송(addingCount=초대 인원)·초대 수락(addingCount=1) 전에 호출.
 *
 * perspective:
 *   - "inviter": 초대하는 소유자·관리자에게 보여줄 문구 (요금제 안내)
 *   - "invitee": 초대 링크를 눌러 합류하려는 사람에게 보여줄 문구 (소유자에게 문의)
 *
 * 뷰어도 FREE 에서는 상한에 포함된다 (정책 §1-2). 뷰어 무료는 유료 플랜의 좌석 규칙이다.
 */
export async function checkMemberLimit(
  projectId: string,
  addingCount: number,
  perspective: "inviter" | "invitee" = "inviter"
): Promise<Response | null> {
  const owner = await getProjectOwnerPlan(projectId);
  // 프로젝트가 없으면 여기서 막지 않는다 — 호출부의 404 처리에 맡긴다
  if (!owner || owner.plan !== "FREE") return null;

  const current = await prisma.tbPjProjectMember.count({
    where: { prjct_id: projectId, mber_sttus_code: "ACTIVE" },
  });
  if (current + addingCount <= FREE_LIMITS.membersPerProject) return null;

  const limit = FREE_LIMITS.membersPerProject;
  const message =
    perspective === "invitee"
      ? `이 프로젝트는 FREE 플랜 멤버 상한(${limit}명)에 도달해 지금은 합류할 수 없습니다. ` +
        "프로젝트 소유자에게 문의해 주세요."
      : `FREE 플랜은 프로젝트당 멤버 ${limit}명(소유자·뷰어 포함)까지입니다. ` +
        `현재 ${current}명이라 ${addingCount}명을 더 초대할 수 없습니다. ` +
        "더 초대하려면 BASIC 플랜이 필요합니다.";

  return apiError(PLAN_LIMIT_CODES.member, message, 403, {
    plan: owner.plan,
    limit,
    current,
    pricingPath: PRICING_PATH,
  });
}

/**
 * ③ 첨부파일 업로드 — 업로드 라우트에서 파일 파싱 전에 호출.
 * 화면마다 버튼을 비활성화하지 않고 서버 403 + 토스트 하나로 통일한다 (정책 §1-10).
 */
export async function checkUploadAllowed(projectId: string): Promise<Response | null> {
  const owner = await getProjectOwnerPlan(projectId);
  if (!owner || owner.plan !== "FREE") return null;

  return apiError(
    PLAN_LIMIT_CODES.upload,
    "FREE 플랜에서는 첨부파일을 올릴 수 없습니다. 첨부파일은 BASIC 플랜부터 제공됩니다.",
    403,
    { plan: owner.plan, pricingPath: PRICING_PATH }
  );
}

/** 프론트에서 에러 코드가 플랜 상한인지 판별 */
export function isPlanLimitCode(code: unknown): boolean {
  return (
    typeof code === "string" &&
    (Object.values(PLAN_LIMIT_CODES) as readonly string[]).includes(code)
  );
}
