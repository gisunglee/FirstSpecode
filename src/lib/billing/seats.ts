/**
 * billing/seats — 좌석 계산 (정책 §1-4)
 *
 * 좌석 = 결제자가 소유한 활성(del_yn='N') 프로젝트 전체에서 **중복 제거한** 편집 가능 멤버
 *        (OWNER/ADMIN/MEMBER, ACTIVE) 수. 같은 사람이 내 프로젝트 3개에 있어도 1좌석.
 *        결제자 본인도 OWNER 로 포함된다. VIEWER 는 무료라 세지 않는다.
 *
 * 불변식: 사용 좌석 ≤ 구매 좌석. 지키는 곳은 3곳뿐(정책 §1-10) — 멤버 초대·수락(planLimits),
 * 좌석 축소 요청(subscription.scheduleSeatReduce). 일상 요청은 아무것도 세지 않는다.
 *
 * 축소 예약(pending_seat_cnt)이 있으면 초대 상한은 예약값을 쓴다 — 다음 결제일에 좌석이
 * 줄어드는 순간 불변식이 깨지는 것을 막기 위해. 지금 늘려 쓰고 싶으면 예약을 취소하면 된다.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isLiveSubscriptionStatus, SPECODE_PRODUCT } from "./constants";

type Db = PrismaClient | Prisma.TransactionClient;

/** 좌석을 차감하는 역할 — VIEWER 제외 */
export const SEAT_ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;

export function isSeatRole(role: string): boolean {
  return (SEAT_ROLES as readonly string[]).includes(role);
}

/**
 * 사용 좌석 수 — 소유 활성 프로젝트의 편집 멤버 distinct.
 *   includeProjectId — 소유권 이전·복구 판정용: "이 프로젝트가 내 것이 된다면" 을 포함해 센다.
 */
export async function countUsedSeats(
  ownerMberId: string,
  opts: { includeProjectId?: string; db?: Db } = {},
): Promise<number> {
  const db = opts.db ?? prisma;
  const rows = await db.tbPjProjectMember.findMany({
    where: {
      mber_sttus_code: "ACTIVE",
      role_code:       { in: [...SEAT_ROLES] },
      project: {
        del_yn: "N",
        OR: [
          { owner_mber_id: ownerMberId },
          ...(opts.includeProjectId ? [{ prjct_id: opts.includeProjectId }] : []),
        ],
      },
    },
    select:   { mber_id: true },
    distinct: ["mber_id"],
  });
  return rows.length;
}

/** 이 회원들 중 이미 좌석을 쓰고 있는(소유 프로젝트 어딘가의 편집 멤버) 사람 — 새 좌석이 필요 없는 사람 */
export async function findExistingSeatHolders(
  ownerMberId: string,
  candidateMberIds: string[],
  db: Db = prisma,
): Promise<Set<string>> {
  if (candidateMberIds.length === 0) return new Set();
  const rows = await db.tbPjProjectMember.findMany({
    where: {
      mber_id:         { in: candidateMberIds },
      mber_sttus_code: "ACTIVE",
      role_code:       { in: [...SEAT_ROLES] },
      project:         { owner_mber_id: ownerMberId, del_yn: "N" },
    },
    select:   { mber_id: true },
    distinct: ["mber_id"],
  });
  return new Set(rows.map((r) => r.mber_id));
}

export type SeatLimitInfo = {
  /** 초대 시 적용되는 상한 — 축소 예약이 있으면 예약값 */
  limit:      number;
  seatCnt:    number;
  pendingCnt: number | null;
};

/**
 * 결제자의 좌석 상한. 살아 있는 구독이 없으면 null (= 좌석 상한 없음:
 * FREE 는 planLimits 의 프로젝트당 5명 규칙, 관리자 수동 부여 BASIC/ENTERPRISE 는 무제한).
 */
export async function getSeatLimit(ownerMberId: string, db: Db = prisma): Promise<SeatLimitInfo | null> {
  const sub = await db.tbBlSubscription.findUnique({
    where:  { mber_id_prdct_code: { mber_id: ownerMberId, prdct_code: SPECODE_PRODUCT } },
    select: { sbscrptn_sttus_code: true, seat_cnt: true, pending_seat_cnt: true },
  });
  if (!sub || !isLiveSubscriptionStatus(sub.sbscrptn_sttus_code)) return null;
  const limit = sub.pending_seat_cnt !== null ? Math.min(sub.seat_cnt, sub.pending_seat_cnt) : sub.seat_cnt;
  return { limit, seatCnt: sub.seat_cnt, pendingCnt: sub.pending_seat_cnt };
}
