/**
 * billing/lock — 프로젝트 결제 잠금 (정책 §1-6)
 *
 * 잠금 = tb_pj_project.lock_yn='Y'. 조회·MCP 읽기는 되고 쓰기 권한만 requirePermission 이 403.
 * 데이터는 절대 지우지 않는다. 잠금은 "지금 이 소유자의 플랜으로는 편집할 수 없다" 는 표시다.
 *
 * 잠금이 걸리는 이벤트 (정책 §1-10):
 *   ① 강등 — 해지 확정·결제 실패 소진 → 소유 프로젝트 전부 잠금 (lockAllOwnedProjects)
 *   ② 소유권 이전·복구 — 새 소유자 플랜으로 상한 초과면 잠금 (applyLockOnTransferOrRestore)
 *   ③ 열린 프로젝트 교체 — 소유자가 A 를 닫고 B 를 열 때 A 에만 (swapOpenProject)
 * 풀리는 이벤트:
 *   ① 재결제 성공 → 전부 해제 (unlockAllOwnedProjects)
 *   ② 소유자 "활성화" 클릭 → 그 프로젝트가 상한 이하면 해제 (unlockProjectByOwner)
 *   ③ 강등 직후 소유 프로젝트가 1개뿐이고 상한 이하면 자동 해제 (autoUnlockIfSingle)
 *   ④ 열린 프로젝트 교체 — B (swapOpenProject)
 *
 * "상한 초과" 판정은 한 함수(isProjectOverPlanLimit)로 통일 (정책 §1-6, 2026-09-26):
 *   FREE               → ⓐ 그 프로젝트의 편집 멤버(OWNER/ADMIN/MEMBER) > 1  — 소유자 혼자여야 한다 (FREE_EDITORS)
 *                        ⓑ 이 프로젝트 말고 잠기지 않은 소유 활성 프로젝트 ≥ 1 — 열린 프로젝트는 1개뿐 (FREE_PROJECTS)
 *                        뷰어는 세지 않는다(무료·무제한).
 *   구독 좌석 있음      → 소유 프로젝트 전체 사용 좌석(이 프로젝트 포함) > 좌석 상한
 *   그 외(수동 BASIC 등) → 초과 없음
 * ⓑ 가 양도·복구·강등·활성화에 같이 적용되므로 "다른 계정이 만들어 양도"로 FREE 소유 상한을
 * 우회할 수 없다. 나머지 프로젝트는 잠긴 채(읽기 전용) 남고 삭제되지 않으며, 어느 것을 열지는
 * 소유자가 "활성화"로 고른다. 결제 도입 전부터 FREE 로 여러 프로젝트를 쓰던 회원은 잠금
 * 이벤트가 없으므로 그대로다(기존은 그대로, 새로 늘리는 것만 막는다).
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FREE_LIMITS, getMemberEffectivePlan } from "@/lib/planLimits";
import { countUsedSeats, getSeatLimit, SEAT_ROLES } from "./seats";

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
  /** FREE — 이 프로젝트의 편집 멤버가 소유자 말고도 있다 */
  | { over: true; reason: "FREE_EDITORS";  editorCount: number;      limit: number }
  /** FREE — 이 프로젝트 말고 이미 열려 있는 소유 프로젝트가 있다 */
  | { over: true; reason: "FREE_PROJECTS"; openProjectCount: number; limit: number }
  | { over: true; reason: "SEATS";         usedSeats: number;        limit: number };

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
    // ⓐ 편집 멤버는 소유자 1명뿐 — 뷰어는 세지 않는다 (정책 §1-2)
    const editorCount = await db.tbPjProjectMember.count({
      where: { prjct_id: projectId, mber_sttus_code: "ACTIVE", role_code: { in: [...SEAT_ROLES] } },
    });
    if (editorCount > FREE_LIMITS.editorsPerProject) {
      return { over: true, reason: "FREE_EDITORS", editorCount, limit: FREE_LIMITS.editorsPerProject };
    }
    // ⓑ 열려 있는 소유 프로젝트는 1개 — 이 프로젝트 말고 잠기지 않은 활성 소유 프로젝트가 있으면
    //    이 프로젝트는 열 수 없다. 강등 직후엔 전부 잠겨 있어 첫 "활성화"는 통과하고, 두 번째부터 막힌다.
    const openOthers = await db.tbPjProject.count({
      where: { owner_mber_id: owner, del_yn: "N", lock_yn: "N", prjct_id: { not: projectId } },
    });
    if (openOthers + 1 > FREE_LIMITS.ownedProjects) {
      return { over: true, reason: "FREE_PROJECTS", openProjectCount: openOthers, limit: FREE_LIMITS.ownedProjects };
    }
    return { over: false };
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

// ─── 열린 프로젝트 교체 (소유자가 A 를 닫고 B 를 연다) ───────────────────────

export type SwapOpenProjectResult =
  | { unlocked: true;  closedProjectIds: string[] }
  /** closeProjectIds 에 요청자 소유가 아니거나 삭제된 프로젝트가 섞여 있다 */
  | { unlocked: false; reason: "INVALID_CLOSE_TARGET"; invalidIds: string[] }
  /** 닫은 뒤에도 상한을 넘는다 — 전체 롤백되어 닫기도 취소되었다 */
  | { unlocked: false; reason: "OVER_LIMIT"; verdict: Extract<OverLimitVerdict, { over: true }> };

/** 트랜잭션 롤백용 내부 신호 — 밖으로 던지지 않는다 */
class SwapRollback extends Error {
  constructor(readonly verdict: Extract<OverLimitVerdict, { over: true }>) {
    super("SWAP_ROLLBACK");
  }
}

/**
 * FREE 소유자가 "열린 프로젝트를 바꾼다" — closeProjectIds 를 잠그고 openProjectId 를 연다.
 *
 * 왜 필요한가: FREE 는 열린 소유 프로젝트가 1개뿐이라 A 를 쓰다 B 를 열려면 A 를 닫아야 하는데,
 * 닫는 수단이 없어 "삭제하거나 양도하라"는 막다른 길이었다(정책 §1-6, 삭제는 절대 없음과 충돌).
 * 여는 흐름 안에서만 닫히며 단독 "닫기" 버튼은 두지 않는다.
 *
 * 안전장치 세 가지:
 *   ① 닫을 대상은 전부 요청자 소유의 살아 있는 프로젝트여야 한다 — 남의 프로젝트를 잠글 수 없다.
 *   ② 닫은 뒤 같은 트랜잭션에서 판정을 다시 돌린다. 여전히 초과면(예: 편집 멤버가 여럿) **전체 롤백** —
 *      "A 는 닫혔는데 B 는 안 열려 둘 다 잠긴" 상태를 만들지 않는다. 사용자가 스스로 복구할 수 없는 상태다.
 *   ③ 트랜잭션 시작 직후 소유자 회원 행을 FOR UPDATE 로 잠근다. 같은 소유자의 교체 요청이 동시에 오면
 *      직렬화되어 "둘 다 열린" 상태(불변식 위반)가 생기지 않는다. 다른 소유자끼리는 서로 막지 않는다.
 *
 * 트랜잭션 클라이언트를 인자로 받지 않는 이유: 이 함수가 트랜잭션 경계 자체다.
 */
export async function swapOpenProject(
  ownerMberId: string,
  openProjectId: string,
  closeProjectIds: string[],
  now: Date,
): Promise<SwapOpenProjectResult> {
  // 열려는 프로젝트가 닫을 목록에 섞여 있으면 무시한다(자기 자신을 닫고 열 수는 없다)
  const closeIds = [...new Set(closeProjectIds)].filter((id) => id !== openProjectId);

  try {
    return await prisma.$transaction(async (tx) => {
      // ③ 같은 소유자의 동시 교체 직렬화
      await tx.$queryRaw`SELECT mber_id FROM tb_cm_member WHERE mber_id = ${ownerMberId} FOR UPDATE`;

      if (closeIds.length > 0) {
        // ① 닫을 대상 검증 — 하나라도 남의 것이면 아무것도 하지 않는다
        const owned = await tx.tbPjProject.findMany({
          where:  { prjct_id: { in: closeIds }, owner_mber_id: ownerMberId, del_yn: "N" },
          select: { prjct_id: true },
        });
        const ownedIds  = new Set(owned.map((p) => p.prjct_id));
        const invalidIds = closeIds.filter((id) => !ownedIds.has(id));
        if (invalidIds.length > 0) {
          return { unlocked: false, reason: "INVALID_CLOSE_TARGET", invalidIds } as const;
        }

        await tx.tbPjProject.updateMany({
          where: { prjct_id: { in: closeIds }, owner_mber_id: ownerMberId, del_yn: "N", lock_yn: "N" },
          data:  { lock_yn: "Y", lock_dt: now },
        });
      }

      // ② 닫은 상태에서 다시 판정 — 초과면 throw 로 전체 롤백
      const r = await unlockProjectByOwner(openProjectId, tx);
      if (!r.unlocked) throw new SwapRollback(r.verdict);

      return { unlocked: true, closedProjectIds: closeIds } as const;
    });
  } catch (err) {
    // 롤백 신호는 정상 결과로 변환한다 — 닫기도 함께 취소되었다
    if (err instanceof SwapRollback) {
      return { unlocked: false, reason: "OVER_LIMIT", verdict: err.verdict };
    }
    throw err;
  }
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
