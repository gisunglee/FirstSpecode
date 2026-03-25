/**
 * POST /api/auth/logout — 로그아웃 처리 (UW-00004)
 *
 * 역할:
 *   1. Refresh Token 폐기 (revoked_dt = NOW())
 *   2. 연결된 세션 무효화 (invald_dt = NOW())
 *
 * 특징:
 *   - 다중 기기 지원 — 요청에 포함된 RT에 해당하는 기기만 무효화
 *   - 이미 폐기된 RT도 200 반환 (멱등성 보장 — 중복 로그아웃 안전 처리)
 *
 * Body: { refreshToken: string }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { hashRefreshToken } from "@/lib/auth";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { refreshToken } = (body ?? {}) as Record<string, unknown>;

  if (!refreshToken || typeof refreshToken !== "string") {
    return apiError("VALIDATION_ERROR", "Refresh Token이 필요합니다.", 400);
  }

  try {
    const tokenHash = hashRefreshToken(refreshToken);

    // RT 조회 — 없으면 이미 폐기된 것으로 간주 (멱등 처리)
    const stored = await prisma.tbCmRefreshToken.findUnique({
      where: { token_hash_val: tokenHash },
    });

    if (!stored || stored.revoked_dt !== null) {
      // 이미 로그아웃된 상태 — 정상 처리로 응답 (클라이언트 재시도 안전)
      return apiSuccess({ message: "로그아웃 되었습니다." });
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      // RT 폐기
      await tx.tbCmRefreshToken.update({
        where: { token_id: stored.token_id },
        data:  { revoked_dt: now },
      });

      // 연결된 세션 무효화 — sesn_id가 있는 경우에만 처리
      if (stored.sesn_id) {
        await tx.tbCmMemberSession.update({
          where: { sesn_id: stored.sesn_id },
          data:  { invald_dt: now },
        });
      }
    });

    return apiSuccess({ message: "로그아웃 되었습니다." });

  } catch (err) {
    console.error("[POST /api/auth/logout] 오류:", err);
    return apiError("DB_ERROR", "로그아웃 처리 중 오류가 발생했습니다.", 500);
  }
}
