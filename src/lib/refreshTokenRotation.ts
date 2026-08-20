import type { Prisma } from "@prisma/client";

/** 네트워크 중복·브라우저 경쟁을 탈취 재사용과 구분하는 최소 유예 구간. */
export const REFRESH_CONCURRENCY_GRACE_MS = 5_000;

export type RevokedRefreshTokenUse = "CONCURRENT_RETRY" | "REUSE_DETECTED";

export class RefreshTokenRotationConflictError extends Error {
  constructor() {
    super("Refresh Token was already consumed by another request.");
    this.name = "RefreshTokenRotationConflictError";
  }
}

export class RefreshSessionInvalidatedError extends Error {
  constructor() {
    super("The member session was invalidated during Refresh Token rotation.");
    this.name = "RefreshSessionInvalidatedError";
  }
}

export function classifyRevokedRefreshTokenUse(
  revokedAt: Date,
  now: Date,
  graceMs = REFRESH_CONCURRENCY_GRACE_MS,
): RevokedRefreshTokenUse {
  const elapsedMs = now.getTime() - revokedAt.getTime();
  return elapsedMs >= 0 && elapsedMs <= graceMs
    ? "CONCURRENT_RETRY"
    : "REUSE_DETECTED";
}

type RotationInput = {
  tokenId: string;
  memberId: string;
  sessionId: string;
  newTokenHash: string;
  autoLoginYn: string;
  newExpiry: Date;
  now: Date;
};

/**
 * 기존 RT의 조건부 소비, 세션 확인, 새 RT 생성을 한 DB 트랜잭션 안에서 수행한다.
 * 호출부는 반드시 prisma.$transaction 콜백 안에서 이 함수를 실행해야 한다.
 */
export async function rotateRefreshTokenAtomically(
  tx: Prisma.TransactionClient,
  input: RotationInput,
): Promise<void> {
  const consumed = await tx.tbCmRefreshToken.updateMany({
    where: {
      token_id: input.tokenId,
      revoked_dt: null,
      expiry_dt: { gte: input.now },
    },
    data: { revoked_dt: input.now },
  });

  if (consumed.count !== 1) {
    throw new RefreshTokenRotationConflictError();
  }

  const touchedSession = await tx.tbCmMemberSession.updateMany({
    where: {
      sesn_id: input.sessionId,
      mber_id: input.memberId,
      invald_dt: null,
    },
    data: { last_acces_dt: input.now },
  });

  if (touchedSession.count !== 1) {
    throw new RefreshSessionInvalidatedError();
  }

  await tx.tbCmRefreshToken.create({
    data: {
      mber_id: input.memberId,
      token_hash_val: input.newTokenHash,
      auto_login_yn: input.autoLoginYn,
      expiry_dt: input.newExpiry,
      sesn_id: input.sessionId,
    },
  });
}
