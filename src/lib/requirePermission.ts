/**
 * requirePermission — API Route 권한 가드 (한 줄로 끝나는 게이트)
 *
 * 역할:
 *   - 인증(JWT/API키) + 프로젝트 멤버십 + 권한 체크를 한 번에 처리
 *   - 성공 시 { mberId, email, role, job, plan } 반환
 *   - 실패 시 401/403 Response 즉시 반환 (호출부는 instanceof 체크)
 *
 * 사용법:
 *   export async function POST(req: NextRequest, { params }: RouteParams) {
 *     const { id: projectId } = await params;
 *     const gate = await requirePermission(req, projectId, "content.create");
 *     if (gate instanceof Response) return gate;  // 401/403 → 즉시 반환
 *     // gate.mberId, gate.role, gate.job 사용 가능
 *     ...
 *   }
 *
 * 인증 전용(프로젝트 무관) 엔드포인트는 기존 `requireAuth` 를 그대로 사용.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/apiResponse";
import { requireAuth, type AuthPayload } from "@/lib/requireAuth";
import {
  hasPermission,
  explainPermission,
  isRoleCode,
  isJobCode,
  isPlanCode,
  type Permission,
  type RoleCode,
  type JobCode,
  type PlanCode,
} from "@/lib/permissions";

export type PermissionContext = AuthPayload & {
  role: RoleCode;
  job:  JobCode;
  plan: PlanCode;
};

/**
 * 권한 가드 — 성공 시 컨텍스트 반환, 실패 시 401/403 Response
 */
export async function requirePermission(
  request: NextRequest,
  projectId: string,
  permission: Permission
): Promise<PermissionContext | Response> {
  // ① 인증 (JWT 또는 API 키)
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;  // 401

  // ② 멤버십 + 멤버 플랜 조회 (한 번의 쿼리로)
  //    - tb_pj_project_member 에서 역할·직무
  //    - tb_cm_member 에서 플랜
  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
    select: {
      role_code:       true,
      job_title_code:  true,
      mber_sttus_code: true,
      member: { select: { plan_code: true } },
    },
  });

  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "프로젝트 멤버가 아닙니다.", 403);
  }

  // ③ 값 타입 가드 — DB에 손상된 값이 섞여 있어도 안전하게 거부
  const role = isRoleCode(membership.role_code)      ? membership.role_code      : null;
  const job  = isJobCode (membership.job_title_code) ? membership.job_title_code : null;
  const plan = isPlanCode(membership.member.plan_code) ? membership.member.plan_code : "FREE";

  if (!role) {
    return apiError("FORBIDDEN", "유효하지 않은 역할 설정입니다.", 403);
  }

  const actor = { role, job, plan };

  // ④ 권한 체크
  if (!hasPermission(actor, permission)) {
    const reason = explainPermission(actor, permission);
    return apiError(reason?.code ?? "FORBIDDEN", reason?.message ?? "권한이 없습니다.", 403);
  }

  return {
    mberId: auth.mberId,
    email:  auth.email,
    role,
    job: job ?? "ETC",
    plan,
  };
}
