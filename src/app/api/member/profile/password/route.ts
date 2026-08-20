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
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  if (auth.credentialType !== "SESSION" || !auth.sesnId) {
    return apiError("UNAUTHORIZED", "로그인이 필요합니다.", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { currentPassword, newPassword } = (body ?? {}) as Record<string, unknown>;

  if (!newPassword || typeof newPassword !== "string") {
    return apiError("VALIDATION_ERROR", "새 비밀번호를 입력해 주세요.", 400);
  }
  if (!PASSWORD_POLICY.test(newPassword)) {
    return apiError("VALIDATION_ERROR", "비밀번호는 영문·숫자·특수문자를 포함한 8자 이상이어야 합니다.", 400);
  }

  try {
    // 비밀번호 변경은 민감 작업이므로 JWT 서명뿐 아니라 현재 세션과 회원 상태를
    // 실제 DB에서 확인한다. 기존 회원 조회를 관계 조회로 대체해 쿼리 수는 늘지 않는다.
    const currentSession = await prisma.tbCmMemberSession.findFirst({
      where: {
        sesn_id: auth.sesnId,
        mber_id: auth.mberId,
        invald_dt: null,
        member: { mber_sttus_code: "ACTIVE" },
      },
      select: {
        member: { select: { pswd_hash: true } },
      },
    });

    if (!currentSession) {
      return apiError("SESSION_INVALIDATED", "유효하지 않은 로그인 세션입니다.", 401);
    }
    const member = currentSession.member;

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

    await prisma.$transaction(async (tx) => {
      // 새 비밀번호 저장
      await tx.tbCmMember.update({
        where: { mber_id: auth.mberId },
        data:  { pswd_hash: newHash, mdfcn_dt: now },
      });

      // AT에 검증된 현재 세션과 연결된 RT를 제외하고 나머지 활성 RT 폐기
      await tx.tbCmRefreshToken.updateMany({
        where: {
          mber_id:    auth.mberId,
          revoked_dt: null,
          OR: [
            { sesn_id: null },
            { sesn_id: { not: auth.sesnId } },
          ],
        },
        data: { revoked_dt: now },
      });

      // 현재 JWT의 세션을 제외한 나머지 세션 무효화
      await tx.tbCmMemberSession.updateMany({
        where: {
          mber_id:   auth.mberId,
          invald_dt: null,
          sesn_id:   { not: auth.sesnId },
        },
        data: { invald_dt: now },
      });
    });

    return apiSuccess({ message: "비밀번호가 변경되었습니다." });

  } catch (err) {
    console.error("[PUT /api/member/profile/password] 오류:", err);
    return apiError("DB_ERROR", "비밀번호 변경 중 오류가 발생했습니다.", 500);
  }
}
