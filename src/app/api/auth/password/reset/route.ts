/**
 * GET  /api/auth/password/reset?token=... — 토큰 유효성 검증 (FID-00030)
 * POST /api/auth/password/reset           — 새 비밀번호 저장  (FID-00032)
 *
 * GET 역할:
 *   - token_val 조회 → PENDING + 미만료 여부 확인
 *   - 무효 시 reason 포함 400 반환
 *
 * POST 역할:
 *   1. 토큰 재검증 (PENDING + 미만료)
 *   2. 기존 비밀번호와 동일 여부 확인
 *   3. 새 비밀번호 bcrypt 해시 저장
 *   4. 토큰 USED 처리
 *   5. 해당 회원의 모든 RT 폐기 + 모든 세션 무효화 (전 기기 로그아웃)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { hashPassword, verifyPassword } from "@/lib/auth";

// 비밀번호 정책: 8자 이상, 영문·숫자·특수문자 포함
const PASSWORD_POLICY = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;

// ── GET: 토큰 유효성 검증 ──────────────────────────────────────
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return apiError("VALIDATION_ERROR", "토큰이 필요합니다.", 400);
  }

  try {
    const record = await prisma.tbCmPasswordResetToken.findUnique({
      where: { token_val: token },
    });

    // code 값이 곧 reason — 클라이언트에서 code를 URL 파라미터로 사용
    if (!record) {
      return apiError("INVALID", "유효하지 않은 링크입니다.", 400);
    }

    if (record.token_sttus_code === "USED") {
      return apiError("USED", "이미 사용된 링크입니다.", 400);
    }

    if (record.token_sttus_code === "EXPIRED" || record.expiry_dt < new Date()) {
      return apiError("EXPIRED", "만료된 링크입니다.", 400);
    }

    return apiSuccess({ valid: true });

  } catch (err) {
    console.error("[GET /api/auth/password/reset] 오류:", err);
    return apiError("DB_ERROR", "일시적인 오류가 발생했습니다.", 500);
  }
}

// ── POST: 새 비밀번호 저장 ─────────────────────────────────────
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { token, newPassword, newPasswordConfirm } = (body ?? {}) as Record<string, unknown>;

  // 입력값 기본 검증
  if (!token || typeof token !== "string") {
    return apiError("VALIDATION_ERROR", "토큰이 필요합니다.", 400);
  }
  if (!newPassword || typeof newPassword !== "string") {
    return apiError("VALIDATION_ERROR", "새 비밀번호를 입력해 주세요.", 400);
  }
  if (newPassword !== newPasswordConfirm) {
    return apiError("VALIDATION_ERROR", "비밀번호가 일치하지 않습니다.", 400);
  }
  if (!PASSWORD_POLICY.test(newPassword)) {
    return apiError("VALIDATION_ERROR", "8자 이상, 영문·숫자·특수문자를 포함해야 합니다.", 400);
  }

  try {
    // 토큰 재검증 (PENDING + 미만료)
    const record = await prisma.tbCmPasswordResetToken.findUnique({
      where:   { token_val: token },
      include: { member: { select: { mber_id: true, pswd_hash: true } } },
    });

    if (!record || record.token_sttus_code !== "PENDING" || record.expiry_dt < new Date()) {
      return apiError("EXPIRED", "재설정 링크가 만료되었습니다. 다시 요청해 주세요.", 400);
    }

    // 기존 비밀번호와 동일 여부 확인
    if (record.member.pswd_hash) {
      const isSame = await verifyPassword(newPassword, record.member.pswd_hash);
      if (isSame) {
        return apiError("SAME_PASSWORD", "기존 비밀번호와 다르게 설정해 주세요.", 400);
      }
    }

    const newHash = await hashPassword(newPassword);
    const now     = new Date();

    await prisma.$transaction(async (tx) => {
      // 새 비밀번호 저장
      await tx.tbCmMember.update({
        where: { mber_id: record.mber_id },
        data:  { pswd_hash: newHash, mdfcn_dt: now },
      });

      // 토큰 사용 완료 처리
      await tx.tbCmPasswordResetToken.update({
        where: { reset_token_id: record.reset_token_id },
        data:  { token_sttus_code: "USED", use_dt: now },
      });

      // 전 기기 RT 폐기 (보안 — 비밀번호 변경 시 모든 기기 로그아웃)
      await tx.tbCmRefreshToken.updateMany({
        where: { mber_id: record.mber_id, revoked_dt: null },
        data:  { revoked_dt: now },
      });

      // 전 기기 세션 무효화
      await tx.tbCmMemberSession.updateMany({
        where: { mber_id: record.mber_id, invald_dt: null },
        data:  { invald_dt: now },
      });
    });

    return apiSuccess({ message: "비밀번호가 재설정되었습니다." });

  } catch (err) {
    console.error("[POST /api/auth/password/reset] 오류:", err);
    return apiError("DB_ERROR", "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
}
