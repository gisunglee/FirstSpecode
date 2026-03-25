/**
 * POST /api/auth/unlock/email/resend — 잠금 해제 메일 재발송 (FID-00021)
 *
 * 역할:
 *   1. 활성 잠금 건 확인 (LOCKED 또는 UNLOCK_PENDING)
 *   2. 새 해제 토큰 생성 → unlock_token_val UPDATE
 *   3. 해제 메일 재발송
 *
 * Body: { email: string }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { generateVerifyToken, unlockTokenExpiryDate, sendUnlockEmail } from "@/lib/auth";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { email } = (body ?? {}) as Record<string, unknown>;

  if (!email || typeof email !== "string") {
    return apiError("VALIDATION_ERROR", "이메일을 입력해 주세요.", 400);
  }

  try {
    const member = await prisma.tbCmMember.findUnique({
      where:  { email_addr: email },
      select: { mber_id: true },
    });

    if (!member) {
      return apiError("NOT_FOUND", "등록되지 않은 이메일입니다.", 404);
    }

    // LOCKED 또는 UNLOCK_PENDING 잠금 건 조회
    const activeLock = await prisma.tbCmAccountLock.findFirst({
      where: {
        mber_id:         member.mber_id,
        lock_sttus_code: { in: ["LOCKED", "UNLOCK_PENDING"] },
        lock_expiry_dt:  { gt: new Date() },
      },
      orderBy: { creat_dt: "desc" },
    });

    if (!activeLock) {
      return apiError("NOT_FOUND", "잠금된 계정이 아닙니다.", 404);
    }

    const token  = generateVerifyToken();
    const expiry = unlockTokenExpiryDate();

    await prisma.tbCmAccountLock.update({
      where: { lock_id: activeLock.lock_id },
      data: {
        unlock_token_val:       token,
        unlock_token_expiry_dt: expiry,
        lock_sttus_code:        "UNLOCK_PENDING",
      },
    });

    await sendUnlockEmail(email, token);

    return apiSuccess({ ok: true });

  } catch (err) {
    console.error("[POST /api/auth/unlock/email/resend] 오류:", err);
    return apiError("DB_ERROR", "재발송 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
}
