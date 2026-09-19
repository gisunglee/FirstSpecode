/**
 * billing/actor — 결제 API 호출자 검증
 *
 * 결제 API(/api/billing/*)는 **로그인 세션(JWT)** 으로만 호출할 수 있다.
 *   - MCP 키(spk_)는 프로젝트 설계 도구용이다. 키가 유출되면 카드 등록·좌석 결제까지
 *     가능해지므로 자격 종류로 차단한다 (requireSystemAdmin 과 같은 fail-secure 원칙).
 *   - 탈퇴·정지 계정은 결제할 수 없다.
 *
 * 성공 시 { mberId, email, isSystemAdmin } — 이메일은 PG customerEmail·영수증 메일 수신처로,
 * isSystemAdmin 은 Mock 결제 허용목록 예외 판정(mock-access.ts)에 쓴다. 세션 자격에서만 오므로
 * MCP 키로 관리자 권한을 흉내낼 수 없다(위에서 이미 SESSION 만 통과).
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/apiResponse";
import { requireAuth } from "@/lib/requireAuth";

export type BillingActor = {
  mberId: string;
  email:  string;
  isSystemAdmin: boolean;
};

export async function requireBillingActor(request: NextRequest): Promise<BillingActor | Response> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  if (auth.credentialType !== "SESSION") {
    return apiError("FORBIDDEN_CREDENTIAL_SCOPE", "결제 API 는 로그인 세션에서만 호출할 수 있습니다.", 403);
  }

  const member = await prisma.tbCmMember.findUnique({
    where:  { mber_id: auth.mberId },
    select: { email_addr: true, mber_sttus_code: true, sys_role_code: true },
  });
  if (!member || member.mber_sttus_code !== "ACTIVE") {
    return apiError("ACCOUNT_INACTIVE", "활성 상태의 계정이 아닙니다.", 403);
  }
  if (!member.email_addr) {
    // 영수증·결제 안내 메일을 보낼 곳이 없으면 결제를 받지 않는다 (법정 고지 경로)
    return apiError("EMAIL_REQUIRED", "결제하려면 프로필에 이메일이 등록되어 있어야 합니다.", 400);
  }

  return { mberId: auth.mberId, email: member.email_addr, isSystemAdmin: member.sys_role_code === "SUPER_ADMIN" };
}
