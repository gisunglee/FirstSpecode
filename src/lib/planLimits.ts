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
 * 유료 플랜의 좌석 상한 (2026-09-20, 결제 2단계):
 *   - 살아 있는 구독(ACTIVE/PAST_DUE/CANCEL_SCHEDULED)이 있으면 "편집 멤버(OWNER/ADMIN/MEMBER)
 *     distinct 수 ≤ 구매 좌석" 을 초대·수락에서 검사한다. VIEWER 는 세지 않는다(정책 §1-4).
 *   - 이미 내 다른 프로젝트에서 좌석을 쓰는 사람을 초대하는 건 새 좌석이 필요 없다.
 *   - 구독 없는 유료 플랜(관리자 수동 부여 BASIC/PRO/ENTERPRISE)은 무제한으로 통과.
 *
 * 시스템 관리자(SUPER_ADMIN)는 플랫폼 운영자 본인이므로 상한을 적용하지 않는다
 * (hasPermission 의 SUPER_ADMIN short-circuit 과 같은 이유).
 *
 * 정책 근거: .claude/biz/B.결제정책.md §1-2 티어, §1-3 소유자 기준, §1-8 첨부, §3 3단계
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/apiResponse";
import { resolveEffectivePlan, type PlanCode } from "@/lib/permissions";
import { BILLING_PATH } from "@/lib/billing/constants";
import { countUsedSeats, findExistingSeatHolders, getSeatLimit, isSeatRole } from "@/lib/billing/seats";

type Db = PrismaClient | Prisma.TransactionClient;

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
  /** 유료 구독의 구매 좌석 초과 — 프론트는 요금제가 아닌 구독 화면(좌석 추가)으로 안내 */
  seat:    "PLAN_LIMIT_SEAT",
} as const;

/** 요금제 안내 경로 — 에러 응답 extra 에 실어 프론트가 링크로 쓴다 */
export const PRICING_PATH = "/intro/pricing";

// ─── 플랜 조회 ────────────────────────────────────────────────────────────────

/**
 * 회원의 실효 플랜. 시스템 관리자는 ENTERPRISE 로 취급(상한 없음).
 * 회원이 없으면 FREE (가장 보수적인 값).
 */
export async function getMemberEffectivePlan(mberId: string, db: Db = prisma): Promise<PlanCode> {
  const member = await db.tbCmMember.findUnique({
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

/** 초대·수락으로 합류하려는 사람 1명 — 역할과, 알 수 있는 식별자(회원 ID 또는 이메일) */
export type MemberAddition = {
  role:    string;
  mberId?: string;
  email?:  string;
};

/**
 * ② 프로젝트당 멤버 수 / 좌석 — 초대 발송(초대 목록)·초대 수락(합류자 1명) 전에 호출.
 *
 * perspective:
 *   - "inviter": 초대하는 소유자·관리자에게 보여줄 문구 (요금제·좌석 추가 안내)
 *   - "invitee": 초대 링크를 눌러 합류하려는 사람에게 보여줄 문구 (소유자에게 문의)
 *
 * FREE: 뷰어도 상한에 포함된다 (정책 §1-2 — 프로젝트당 5명, 소유자·뷰어 포함).
 * 구독 좌석: 편집 역할(OWNER/ADMIN/MEMBER)만 세고, 이미 내 프로젝트 어딘가에서 좌석을 쓰는
 *           사람은 새 좌석을 먹지 않는다. 축소 예약이 있으면 예약값이 상한(seats.getSeatLimit).
 */
export async function checkMemberLimit(
  projectId: string,
  adding: MemberAddition[],
  perspective: "inviter" | "invitee" = "inviter"
): Promise<Response | null> {
  const owner = await getProjectOwnerPlan(projectId);
  // 프로젝트가 없으면 여기서 막지 않는다 — 호출부의 404 처리에 맡긴다
  if (!owner) return null;

  if (owner.plan === "FREE") {
    return checkFreeMemberLimit(projectId, owner.plan, adding.length, perspective);
  }

  return checkSeatLimitForOwner(owner.ownerMberId, owner.plan, adding, perspective);
}

/**
 * ②-b 구독 좌석만 검사 — 역할 변경(VIEWER → MEMBER/ADMIN) 전에 호출.
 *
 * 초대·수락과 다른 점: 멤버 수는 늘지 않고 편집 멤버만 는다. 그래서 FREE 의 "프로젝트당 5명"
 * 규칙은 건드리지 않고(멤버 수 불변) 구독 좌석 불변식만 지킨다. 뷰어로 내리는 변경은 검사 없음.
 * 2026-09-20 사용자 결정 — 편집 역할이 되는 모든 경로(초대·수락·승격)가 좌석을 먹는다.
 */
export async function checkSeatLimit(
  projectId: string,
  adding: MemberAddition[],
): Promise<Response | null> {
  const owner = await getProjectOwnerPlan(projectId);
  if (!owner || owner.plan === "FREE") return null;
  return checkSeatLimitForOwner(owner.ownerMberId, owner.plan, adding, "inviter");
}

/** 구독 좌석 상한 본체 — checkMemberLimit(유료)·checkSeatLimit 공용 */
async function checkSeatLimitForOwner(
  ownerMberId: string,
  plan: PlanCode,
  adding: MemberAddition[],
  perspective: "inviter" | "invitee",
): Promise<Response | null> {
  const owner = { ownerMberId, plan };
  const seat = await getSeatLimit(owner.ownerMberId);
  if (!seat) return null;  // 구독 없는 유료(수동 부여) — 무제한

  // 좌석을 먹는 신규 편집 멤버만 센다
  const editors = adding.filter((a) => isSeatRole(a.role));
  if (editors.length === 0) return null;

  // 각 초대자를 회원 ID 로 해석한다 — 회원 ID 가 있으면 그대로, 이메일이면 회원을 찾아서.
  // 미가입 이메일은 해석 불가(null) → 확실히 새 좌석.
  const emails = editors
    .filter((a) => !a.mberId && a.email)
    .map((a) => a.email!.toLowerCase());
  const idByEmail = new Map<string, string>();
  if (emails.length > 0) {
    const members = await prisma.tbCmMember.findMany({
      where:  { email_addr: { in: emails } },
      select: { mber_id: true, email_addr: true },
    });
    for (const m of members) if (m.email_addr) idByEmail.set(m.email_addr.toLowerCase(), m.mber_id);
  }
  const resolvedIds = editors.map((a) => a.mberId ?? (a.email ? idByEmail.get(a.email.toLowerCase()) ?? null : null));

  // 이미 좌석을 쓰는 사람은 새 좌석이 아니다. 같은 사람이 목록에 두 번 있어도 한 좌석.
  const knownIds = resolvedIds.filter((v): v is string => v !== null);
  const holders  = await findExistingSeatHolders(owner.ownerMberId, knownIds);
  const newIds   = new Set(knownIds.filter((id) => !holders.has(id)));
  const unresolvedCount = resolvedIds.filter((v) => v === null).length;
  const newSeats = newIds.size + unresolvedCount;

  const used = await countUsedSeats(owner.ownerMberId);
  if (used + newSeats <= seat.limit) return null;

  const message =
    perspective === "invitee"
      ? "이 프로젝트 소유자의 구매 좌석이 모두 사용 중이라 지금은 합류할 수 없습니다. 프로젝트 소유자에게 문의해 주세요."
      : `구매한 좌석 ${seat.limit}개 중 ${used}개를 사용 중이라 편집 멤버 ${newSeats}명을 더 초대할 수 없습니다. ` +
        (seat.pendingCnt !== null && seat.pendingCnt < seat.seatCnt
          ? "좌석 축소 예약이 있어 예약된 좌석 수가 상한으로 적용됩니다. 예약을 취소하거나 좌석을 추가해 주세요."
          : "설정 > 구독·결제에서 좌석을 추가해 주세요. 뷰어는 좌석을 차지하지 않습니다.");

  return apiError(PLAN_LIMIT_CODES.seat, message, 403, {
    plan:        owner.plan,
    limit:       seat.limit,
    current:     used,
    billingPath: BILLING_PATH,
  });
}

/** FREE — 프로젝트당 멤버 5명 (역할 무관) */
async function checkFreeMemberLimit(
  projectId: string,
  plan: PlanCode,
  addingCount: number,
  perspective: "inviter" | "invitee"
): Promise<Response | null> {
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
    plan,
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
