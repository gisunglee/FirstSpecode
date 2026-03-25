/**
 * POST /api/auth/unlock/complete — 계정 잠금 해제 처리
 *
 * 역할:
 *   1. unlock_token_val로 잠금 건 조회
 *   2. UNLOCK_PENDING + 미만료 확인
 *   3. 잠금 상태 → UNLOCKED
 *
 * Body: { token: string }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { token } = (body ?? {}) as Record<string, unknown>;

  if (!token || typeof token !== "string") {
    return apiError("VALIDATION_ERROR", "해제 토큰이 필요합니다.", 400);
  }

  try {
    const lock = await prisma.tbCmAccountLock.findUnique({
      where: { unlock_token_val: token },
    });

    if (!lock) {
      return apiError("INVALID_TOKEN", "유효하지 않은 잠금 해제 링크입니다.", 400);
    }

    if (lock.lock_sttus_code !== "UNLOCK_PENDING") {
      return apiError("INVALID_TOKEN", "유효하지 않은 잠금 해제 링크입니다.", 400);
    }

    if (!lock.unlock_token_expiry_dt || new Date() > lock.unlock_token_expiry_dt) {
      return apiError("TOKEN_EXPIRED", "잠금 해제 링크가 만료되었습니다.", 400);
    }

    // 잠금 해제 처리
    await prisma.tbCmAccountLock.update({
      where: { lock_id: lock.lock_id },
      data: {
        lock_sttus_code:  "UNLOCKED",
        unlocked_dt:      new Date(),
        unlock_token_val: null,
      },
    });

    return apiSuccess({ ok: true });

  } catch (err) {
    console.error("[POST /api/auth/unlock/complete] 오류:", err);
    return apiError("DB_ERROR", "잠금 해제 처리 중 오류가 발생했습니다.", 500);
  }
}
