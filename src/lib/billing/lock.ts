/**
 * billing/lock — 프로젝트 결제 잠금 (정책 §1-6)
 *
 * 잠금 = tb_pj_project.lock_yn='Y'. 조회·MCP 읽기는 되고 쓰기 권한만 requirePermission 이 403.
 * 데이터는 절대 지우지 않는다. 잠금은 "지금 이 소유자의 플랜으로는 편집할 수 없다" 는 표시다.
 *
 * 잠금이 걸리는 이벤트 (3개, 정책 §1-10):
 *   ① 강등 — 해지 확정·결제 실패 소진 → 소유 프로젝트 전부 잠금 (lockAllOwnedProjects)
 *   ② 소유권 이전·복구 — 새 소유자 플랜으로 상한 초과면 잠금 (applyLockOnTransferOrRestore)
 * 풀리는 이벤트:
 *   ① 재결제 성공 → 전부 해제 (unlockAllOwnedProjects)
 *   ② 소유자 "활성화" 클릭 → 그 프로젝트가 상한 이하면 해제 (unlockProjectByOwner)
 *   ③ 강등 직후 소유 프로젝트가 1개뿐이고 상한 이하면 자동 해제 (autoUnlockIfSingle)
 *
 * "상한 초과" 판정은 한 함수(isProjectOverPlanLimit)로 통일:
 *   FREE               → 그 프로젝트의 활성 멤버 수 > 5 (소유자·뷰어 포함 — FREE 규칙 한 줄)
 *   구독 좌석 있음      → 소유 프로젝트 전체 사용 좌석(이 프로젝트 포함) > 좌석 상한
 *   그 외(수동 BASIC 등) → 초과 없음
 * FREE 의 "소유 프로젝트 1개" 상한은 잠금 판정에 넣지 않는다 — 기존 것은 그대로, 새로 늘리는
 * 것만 막는다는 정책(§1-6)과 "활성화" 조건(멤버 5명 이하)이 그렇게 정해져 있다.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FREE_LIMITS, getMemberEffectivePlan } from "@/lib/planLimits";
import { countUsedSeats, getSeatLimit } from "./seats";

type Db = PrismaClient | Prisma.TransactionClient;

// ─── 일괄 잠금·해제 (강등 / 재결제) ──────────────────────────────────────────

/** 소유한 활성 프로젝트 전부 잠금. 이미 잠긴 것은 건드리지 않는다(lock_dt 보존). 잠근 개수 반환 */
export async function lockAllOwnedProjects(ownerMberId: string, now: Date, db: Db = prisma): Promise<number> {
  const r = await db.tbPjProject.updateMany({
    where: { owner_mber_id: ownerMberId, del_yn: "N", lock_yn: "N" },
    data:  { lock_yn: "Y", lock_dt: now },
  });
  return r.count;
}

/** 소유한 프로젝트 전부 해제 (재결제 성공). 해제한 개수 반환 */
export async function unlockAllOwnedProjects(ownerMberId: string, db: Db = prisma): Promise<number> {
  const r = await db.tbPjProject.updateMany({
    where: { owner_mber_id: ownerMberId, lock_yn: "Y" },
    data:  { lock_yn: "N", lock_dt: null },
  });
  return r.count;
}

// ─── 상한 초과 판정 ──────────────────────────────────────────────────────────

export type OverLimitVerdict =
  | { over: false }
  | { over: true; reason: "FREE_MEMBERS"; memberCount: number; limit: number }
  | { over: true; reason: "SEATS";        usedSeats: number;   limit: number };

/**
 * "이 프로젝트가 이 소유자 밑에 있으면 상한을 넘는가"
 *   ownerMberId 를 생략하면 프로젝트의 현재 owner_mber_id 로 판정한다.
 *   소유권 이전 전 미리 보려면 새 소유자를 넘긴다.
 */
export async function isProjectOverPlanLimit(
  projectId: string,
  ownerMberId?: string,
  db: Db = prisma,
): Promise<OverLimitVerdict> {
  let owner = ownerMberId;
  if (!owner) {
    const p = await db.tbPjProject.findUnique({ where: { prjct_id: projectId }, select: { owner_mber_id: true } });
    if (!p) return { over: false };
    owner = p.owner_mber_id;
  }

  const plan = await getMemberEffectivePlan(owner, db);

  if (plan === "FREE") {
    const memberCount = await db.tbPjProjectMember.count({
      where: { prjct_id: projectId, mber_sttus_code: "ACTIVE" },
    });
    return memberCount > FREE_LIMITS.membersPerProject
      ? { over: true, reason: "FREE_MEMBERS", memberCount, limit: FREE_LIMITS.membersPerProject }
      : { over: false };
  }

  const seat = await getSeatLimit(owner, db);
  if (!seat) return { over: false };  // 수동 부여 BASIC/PRO/ENTERPRISE — 좌석 상한 없음

  const usedSeats = await countUsedSeats(owner, { includeProjectId: projectId, db });
  return usedSeats > seat.limit
    ? { over: true, reason: "SEATS", usedSeats, limit: seat.limit }
    : { over: false };
}

// ─── 개별 해제 / 자동 해제 ───────────────────────────────────────────────────

export type UnlockResult =
  | { unlocked: true }
  | { unlocked: false; verdict: Extract<OverLimitVerdict, { over: true }> };

/**
 * 소유자 "활성화" — 상한 이하면 그 프로젝트만 해제. 초과면 이유를 돌려준다(라우트가 403 안내).
 * 이미 풀려 있으면 unlocked:true (멱등).
 */
export async function unlockProjectByOwner(projectId: string, db: Db = prisma): Promise<UnlockResult> {
  const verdict = await isProjectOverPlanLimit(projectId, undefined, db);
  if (verdict.over) return { unlocked: false, verdict };
  await db.tbPjProject.update({
    where: { prjct_id: projectId },
    data:  { lock_yn: "N", lock_dt: null },
  });
  return { unlocked: true };
}

/**
 * 강등 직후 — 소유 활성 프로젝트가 정확히 1개이고 상한 이하면 자동 해제.
 * 여러 개면 누구를 남길지 시스템이 고를 수 없으니 소유자가 "활성화"로 선택한다(정책 §6).
 * 해제한 프로젝트 ID 또는 null.
 */
export async function autoUnlockIfSingle(ownerMberId: string, db: Db = prisma): Promise<string | null> {
  const owned = await db.tbPjProject.findMany({
    where:  { owner_mber_id: ownerMberId, del_yn: "N" },
    select: { prjct_id: true },
    take:   2,
  });
  if (owned.length !== 1) return null;
  const only = owned[0]!.prjct_id;
  const r = await unlockProjectByOwner(only, db);
  return r.unlocked ? only : null;
}

/**
 * 소유권 이전·복구 뒤 — 새 소유자 기준으로 상한 초과면 잠금, 아니면 해제.
 * 이전·복구를 막지는 않는다(탈퇴 흐름이 막히면 안 됨 — 정책 §1-6). 잠긴 채 넘어가고,
 * 결제하거나 정리하면 풀린다. 잠금 여부 반환.
 */
export async function applyLockOnTransferOrRestore(projectId: string, now: Date, db: Db = prisma): Promise<boolean> {
  const verdict = await isProjectOverPlanLimit(projectId, undefined, db);
  await db.tbPjProject.update({
    where: { prjct_id: projectId },
    data:  verdict.over ? { lock_yn: "Y", lock_dt: now } : { lock_yn: "N", lock_dt: null },
  });
  return verdict.over;
}

/** 소유자의 잠긴 프로젝트 수 — 강등 메일·구독 화면 안내용 */
export async function countLockedProjects(ownerMberId: string, db: Db = prisma): Promise<number> {
  return db.tbPjProject.count({ where: { owner_mber_id: ownerMberId, del_yn: "N", lock_yn: "Y" } });
}
