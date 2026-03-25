/**
 * GET /api/member/profile/email/complete — 이메일 변경 인증 완료 (FID-00044)
 *
 * 역할:
 *   1. 토큰 유효성 검증 (존재·만료·상태)
 *   2. 이메일 중복 재확인 (토큰 발급 후 다른 회원이 선점했을 수 있음)
 *   3. tb_cm_member.email_addr 업데이트
 *   4. 토큰 상태 → VERIFIED
 *
 * Query: ?token=<verifyToken>
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return apiError("VALIDATION_ERROR", "토큰이 필요합니다.", 400);
  }

  try {
    const record = await prisma.tbCmEmailVerification.findUnique({
      where: { vrfctn_token_val: token },
    });

    if (!record) {
      return apiError("INVALID_TOKEN", "유효하지 않은 인증 링크입니다.", 400);
    }

    if (record.vrfctn_ty_code !== "EMAIL_CHANGE") {
      return apiError("INVALID_TOKEN", "유효하지 않은 인증 링크입니다.", 400);
    }

    if (record.vrfctn_sttus_code === "VERIFIED") {
      return apiError("ALREADY_VERIFIED", "이미 완료된 이메일 변경입니다.", 400);
    }

    if (record.vrfctn_sttus_code === "EXPIRED") {
      return apiError("EXPIRED", "인증 링크가 만료되었습니다.", 400);
    }

    if (record.vrfctn_sttus_code !== "PENDING") {
      return apiError("INVALID_TOKEN", "유효하지 않은 인증 링크입니다.", 400);
    }

    // 만료 시간 검사
    if (new Date() > record.expiry_dt) {
      await prisma.tbCmEmailVerification.update({
        where: { vrfctn_token_val: token },
        data:  { vrfctn_sttus_code: "EXPIRED" },
      });
      return apiError("EXPIRED", "인증 링크가 만료되었습니다.", 400);
    }

    const newEmail = record.email_addr;

    // 이메일 중복 재확인 (토큰 발급 이후 다른 회원이 선점했을 수 있음)
    const existing = await prisma.tbCmMember.findUnique({
      where:  { email_addr: newEmail },
      select: { mber_id: true },
    });

    if (existing && existing.mber_id !== record.mber_id) {
      // 해당 토큰 만료 처리
      await prisma.tbCmEmailVerification.update({
        where: { vrfctn_token_val: token },
        data:  { vrfctn_sttus_code: "EXPIRED" },
      });
      return apiError("DUPLICATE_EMAIL", "이미 사용 중인 이메일입니다.", 409);
    }

    await prisma.$transaction(async (tx) => {
      // 이메일 업데이트
      await tx.tbCmMember.update({
        where: { mber_id: record.mber_id },
        data:  { email_addr: newEmail, mdfcn_dt: new Date() },
      });

      // 토큰 상태 → VERIFIED
      await tx.tbCmEmailVerification.update({
        where: { vrfctn_token_val: token },
        data:  { vrfctn_sttus_code: "VERIFIED" },
      });
    });

    return apiSuccess({ email: newEmail });

  } catch (err) {
    console.error("[GET /api/member/profile/email/complete] 오류:", err);
    return apiError("DB_ERROR", "이메일 변경 완료 처리 중 오류가 발생했습니다.", 500);
  }
}
