/**
 * planLimits — 플랜 상한 검사 (FREE 브레이크)
 *
 * 역할:
 *   - FREE 플랜의 상한 3가지를 API 진입점에서 한 줄로 검사한다.
 *       ① 소유 프로젝트 수                → 프로젝트 생성·복사
 *       ② 프로젝트당 편집 멤버(소유자 1명뿐) → 멤버 초대·초대 수락·뷰어 승격. 뷰어는 무료·무제한
 *       ③ 첨부파일 업로드 차단            → 첨부 업로드 라우트
 *   - 상한 403 응답에는 "BASIC 으로 가면 몇 좌석·월 얼마"(requiredSeats·monthlyAmount·billingPath)를
 *     실어 준다. 안내 다이얼로그가 이 값으로 구독 시작 화면(좌석 기본값 채워짐)으로 바로 보낸다.
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
import { PRICING } from "@/app/intro/_components/siteInfo";
import { BILLING_PATH, PRODUCTS, SPECODE_PRODUCT } from "@/lib/billing/constants";
import { formatWon } from "@/lib/billing/pricing";
import { countUsedSeats, findExistingSeatHolders, getSeatLimit, isSeatRole, SEAT_ROLES } from "@/lib/billing/seats";

type Db = PrismaClient | Prisma.TransactionClient;

// ─── FREE 상한 값 — 요금제 페이지(siteInfo.PRICING)와 같은 상수를 읽는다 ───────
export const FREE_LIMITS = {
  /** 소유(OWNER) 가능한 활성 프로젝트 수 */
  ownedProjects: PRICING.freeProjectLimit,
  /** 프로젝트당 편집 멤버(OWNER/ADMIN/MEMBER) 수 — 소유자 본인뿐. 뷰어는 세지 않는다(무료·무제한) */
  editorsPerProject: PRICING.freeEditorLimit,
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
 * FREE 와 구독 모두 편집 역할(OWNER/ADMIN/MEMBER)만 센다 — 뷰어는 무료·무제한 (정책 §1-2, §1-4).
 * FREE:      편집 멤버는 소유자 1명뿐 → 편집 역할로 들어오는 사람이 있으면 막힌다.
 * 구독 좌석: 이미 내 프로젝트 어딘가에서 좌석을 쓰는 사람은 새 좌석을 먹지 않는다.
 *           축소 예약이 있으면 예약값이 상한(seats.getSeatLimit).
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
    return checkFreeEditorLimit(projectId, owner.ownerMberId, owner.plan, adding, perspective);
  }

  return checkSeatLimitForOwner(owner.ownerMberId, owner.plan, adding, perspective);
}

/**
 * ②-b 편집 역할 승격 검사 — 역할 변경(VIEWER → MEMBER/ADMIN) 전에 호출.
 *
 * 초대·수락과 다른 점: 멤버 수는 늘지 않고 편집 멤버만 는다. FREE 는 "편집 멤버는 소유자뿐",
 * 구독은 "편집 멤버 ≤ 구매 좌석" — 둘 다 편집 멤버가 느는 경로라 초대와 같은 검사를 탄다.
 * 뷰어로 내리는 변경은 검사 없음. 2026-09-20 사용자 결정 — 편집 역할이 되는 모든 경로(초대·수락·승격)가 좌석을 먹는다.
 */
export async function checkSeatLimit(
  projectId: string,
  adding: MemberAddition[],
): Promise<Response | null> {
  const owner = await getProjectOwnerPlan(projectId);
  if (!owner) return null;
  if (owner.plan === "FREE") {
    return checkFreeEditorLimit(projectId, owner.ownerMberId, owner.plan, adding, "inviter");
  }
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

  const newSeats = await countNewSeats(owner.ownerMberId, editors);
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

/**
 * 편집 역할로 들어오는 사람들 중 새 좌석이 필요한 수.
 *   - 회원 ID 가 있으면 그대로, 이메일이면 회원을 찾아 해석한다. 미가입 이메일은 해석 불가 → 확실히 새 좌석.
 *   - 이미 내 소유 프로젝트 어딘가에서 좌석을 쓰는 사람은 새 좌석이 아니다. 같은 사람이 목록에 두 번 있어도 한 좌석.
 * 구독 좌석 검사와 FREE 의 "BASIC 으로 가면 몇 좌석" 안내가 같은 계산을 쓴다.
 */
async function countNewSeats(ownerMberId: string, editors: MemberAddition[]): Promise<number> {
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

  const knownIds = resolvedIds.filter((v): v is string => v !== null);
  const holders  = await findExistingSeatHolders(ownerMberId, knownIds);
  const newIds   = new Set(knownIds.filter((id) => !holders.has(id)));
  const unresolvedCount = resolvedIds.filter((v) => v === null).length;
  return newIds.size + unresolvedCount;
}

/**
 * FREE — 프로젝트당 편집 멤버는 소유자 1명뿐 (정책 §1-2). 뷰어는 세지 않는다.
 *
 * 소유자가 이미 1명을 채우므로 편집 역할로 들어오는 사람이 한 명이라도 있으면 막힌다.
 * 결제 도입 전부터 FREE 로 편집자 여러 명을 쓰던 프로젝트도 같은 규칙 — 기존은 그대로, 추가만 막는다(§1-6).
 * 응답에 "BASIC 으로 가면 몇 좌석·월 얼마"를 실어 다이얼로그가 구독 시작 화면으로 바로 보낼 수 있게 한다.
 */
async function checkFreeEditorLimit(
  projectId: string,
  ownerMberId: string,
  plan: PlanCode,
  adding: MemberAddition[],
  perspective: "inviter" | "invitee"
): Promise<Response | null> {
  const editorsAdding = adding.filter((a) => isSeatRole(a.role));
  if (editorsAdding.length === 0) return null;  // 뷰어는 무료·무제한

  const current = await prisma.tbPjProjectMember.count({
    where: { prjct_id: projectId, mber_sttus_code: "ACTIVE", role_code: { in: [...SEAT_ROLES] } },
  });
  const limit = FREE_LIMITS.editorsPerProject;
  if (current + editorsAdding.length <= limit) return null;  // 소유자가 없는 프로젝트뿐 — 이론상 도달 불가

  // BASIC 으로 가면 필요한 좌석 = 소유 프로젝트 전체 편집 멤버(distinct) + 이번에 새로 좌석이 필요한 사람
  const [used, newSeats] = await Promise.all([
    countUsedSeats(ownerMberId),
    countNewSeats(ownerMberId, editorsAdding),
  ]);
  const requiredSeats = used + newSeats;
  const monthlyAmount = requiredSeats * PRODUCTS[SPECODE_PRODUCT].unitPrice;

  const message =
    perspective === "invitee"
      ? "이 프로젝트는 FREE 플랜이라 소유자 외에는 편집 멤버로 합류할 수 없습니다. 프로젝트 소유자에게 문의해 주세요."
      : "FREE 플랜에서는 소유자만 편집할 수 있습니다. " +
        `편집 멤버 ${editorsAdding.length}명을 더 두려면 BASIC 좌석 ${requiredSeats}개(월 ${formatWon(monthlyAmount)})가 필요합니다. ` +
        "뷰어는 무료로 제한 없이 초대할 수 있습니다.";

  return apiError(PLAN_LIMIT_CODES.member, message, 403, {
    plan,
    limit,
    current,
    requiredSeats,
    monthlyAmount,
    pricingPath: PRICING_PATH,
    billingPath: BILLING_PATH,
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
