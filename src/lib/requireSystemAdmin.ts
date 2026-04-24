/**
 * requireSystemAdmin — 시스템 관리자 전용 API 게이트 (/api/admin/**)
 *
 * 역할:
 *   - JWT 인증(= 실제 로그인 세션)만 허용. MCP 키(spk_)는 거부.
 *   - tb_cm_member.sys_role_code === "SUPER_ADMIN" 인 사용자만 통과.
 *   - 성공 시 { mberId, email, sesnId, systemRole, ipAddr, userAgent } 반환
 *     → 감사 로그에 바로 넣을 수 있는 형태
 *   - 실패 시 401/403 Response 즉시 반환.
 *
 * 사용법:
 *   export async function POST(req: NextRequest) {
 *     const gate = await requireSystemAdmin(req);
 *     if (gate instanceof Response) return gate;
 *     await logAdminAction({ adminMberId: gate.mberId, actionType: "USER_SUSPEND", ... });
 *     ...
 *   }
 *
 * 설계 근거:
 *   - 시스템 관리자 권한은 **로그인 세션에서만** 유효해야 한다.
 *     MCP 키가 탈취되어도 `/admin/**` 엔드포인트는 보호된다.
 *   - requirePermission 과 분리된 별도 함수 — 프로젝트 ID 가 필요 없고,
 *     멤버십 조회도 필요 없기 때문에 한 번의 tb_cm_member 조회로 끝.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/apiResponse";
import { requireAuth } from "@/lib/requireAuth";
import { isSystemRoleCode, type SystemRoleCode } from "@/lib/permissions";

export type SystemAdminContext = {
  mberId: string;
  email:  string;
  sesnId: string;              // JWT 세션에서만 통과하므로 반드시 존재
  systemRole: SystemRoleCode;
  ipAddr?:    string;
  userAgent?: string;
};

/** 요청 헤더에서 클라이언트 IP 추출 (Vercel/Nginx 프록시 대응) */
function extractIpAddr(request: NextRequest): string | undefined {
  // x-forwarded-for: 프록시 체인 (가장 왼쪽이 원본 클라이언트)
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  // x-real-ip: Nginx 표준 설정
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri;
  return undefined;
}

export async function requireSystemAdmin(
  request: NextRequest
): Promise<SystemAdminContext | Response> {
  // ① 인증
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth; // 401

  // ② MCP 키 거부 — 시스템 관리자 권한은 로그인 세션(JWT)에서만 유효
  //    API 키 인증 경로는 sesnId 가 undefined 로 온다.
  if (!auth.sesnId) {
    return apiError(
      "FORBIDDEN_ADMIN_REQUIRES_SESSION",
      "시스템 관리자 API 는 로그인 세션에서만 호출 가능합니다.",
      403
    );
  }

  // ③ sys_role_code 조회
  const member = await prisma.tbCmMember.findUnique({
    where:  { mber_id: auth.mberId },
    select: { sys_role_code: true },
  });

  if (!member || !isSystemRoleCode(member.sys_role_code)) {
    // 존재 자체를 숨기기 위해 404 가 아닌 403 반환
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  return {
    mberId:     auth.mberId,
    email:      auth.email,
    sesnId:     auth.sesnId,
    systemRole: member.sys_role_code,
    ipAddr:     extractIpAddr(request),
    userAgent:  request.headers.get("user-agent") ?? undefined,
  };
}
