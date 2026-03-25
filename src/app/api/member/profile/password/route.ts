/**
 * PUT /api/member/profile/password — 비밀번호 변경 (FID-00041)
 *
 * 역할:
 *   1. 현재 비밀번호 검증 (pswd_hash IS NOT NULL인 경우만)
 *   2. 새 비밀번호 정책 검증
 *   3. 비밀번호 업데이트
 *   4. 현재 세션 제외 나머지 RT 폐기 + 세션 무효화
 *
 * Body: { currentPassword?: string, newPassword: string }
 * Header: Authorization: Bearer <AT>
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireAuth } from "@/lib/requireAuth";
import { hashPassword, verifyPassword } from "@/lib/auth";

const PASSWORD_POLICY = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;

export async function PUT(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { currentPassword, newPassword, currentRefreshToken } = (body ?? {}) as Record<string, unknown>;

  if (!newPassword || typeof newPassword !== "string") {
    return apiError("VALIDATION_ERROR", "새 비밀번호를 입력해 주세요.", 400);
  }
  if (!PASSWORD_POLICY.test(newPassword)) {
    return apiError("VALIDATION_ERROR", "비밀번호는 영문·숫자·특수문자를 포함한 8자 이상이어야 합니다.", 400);
  }

  try {
    const member = await prisma.tbCmMember.findUnique({
      where:  { mber_id: auth.mberId },
      select: { pswd_hash: true },
    });

    if (!member) {
      return apiError("NOT_FOUND", "회원 정보를 찾을 수 없습니다.", 404);
    }

    // 비밀번호가 있는 계정 — 현재 비밀번호 검증
    if (member.pswd_hash) {
      if (!currentPassword || typeof currentPassword !== "string") {
        return apiError("VALIDATION_ERROR", "현재 비밀번호를 입력해 주세요.", 400);
      }
      const isValid = await verifyPassword(currentPassword, member.pswd_hash);
      if (!isValid) {
        return apiError("INVALID_CREDENTIALS", "현재 비밀번호가 올바르지 않습니다.", 401);
      }
    }

    const newHash = await hashPassword(newPassword);
    const now     = new Date();

    // 현재 RT의 hash 값 (클라이언트에서 전달 — 현재 세션 제외용)
    const currentRtHash = (typeof currentRefreshToken === "string" && currentRefreshToken)
      ? (await import("@/lib/auth")).hashRefreshToken(currentRefreshToken)
      : null;

    await prisma.$transaction(async (tx) => {
      // 새 비밀번호 저장
      await tx.tbCmMember.update({
        where: { mber_id: auth.mberId },
        data:  { pswd_hash: newHash, mdfcn_dt: now },
      });

      // 현재 RT 제외 나머지 활성 RT 폐기
      await tx.tbCmRefreshToken.updateMany({
        where: {
          mber_id:    auth.mberId,
          revoked_dt: null,
          ...(currentRtHash ? { token_hash_val: { not: currentRtHash } } : {}),
        },
        data: { revoked_dt: now },
      });

      // 현재 세션(현재 RT와 연결된 세션) 제외 나머지 세션 무효화
      if (currentRtHash) {
        const currentRt = await tx.tbCmRefreshToken.findUnique({
          where: { token_hash_val: currentRtHash },
          select: { sesn_id: true },
        });
        await tx.tbCmMemberSession.updateMany({
          where: {
            mber_id:   auth.mberId,
            invald_dt: null,
            ...(currentRt?.sesn_id ? { sesn_id: { not: currentRt.sesn_id } } : {}),
          },
          data: { invald_dt: now },
        });
      } else {
        // currentRefreshToken 없으면 모든 세션 무효화
        await tx.tbCmMemberSession.updateMany({
          where: { mber_id: auth.mberId, invald_dt: null },
          data:  { invald_dt: now },
        });
      }
    });

    return apiSuccess({ message: "비밀번호가 변경되었습니다." });

  } catch (err) {
    console.error("[PUT /api/member/profile/password] 오류:", err);
    return apiError("DB_ERROR", "비밀번호 변경 중 오류가 발생했습니다.", 500);
  }
}
