/**
 * GET /api/projects/[id]/my-role — 내 역할·직무·플랜 조회 (UW-00011)
 *
 * 역할:
 *   - 현재 로그인 사용자의 프로젝트 내 역할/직무 + 계정 플랜 반환
 *   - 클라이언트의 UI 권한 제어(메뉴 숨김·버튼 비활성화) 판별용
 *   - 미가입 또는 비활성 멤버 → 403
 *
 * 응답 계약: usePermissions 훅(src/hooks/useMyRole.ts)과 맞춰져 있음
 *   { myRole: RoleCode, myJob: JobCode, myPlan: PlanCode }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { isRoleCode, isJobCode, isPlanCode } from "@/lib/permissions";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  // 멤버십 + 계정 플랜을 한 번에 조회
  const membership = await prisma.tbPjProjectMember.findUnique({
    where:  { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
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

  // DB 값 타입 가드 — 허용 외 값은 안전한 기본값으로 폴백
  // 구 7-role 데이터가 마이그레이션 전이면 role_code 가 허용 외일 수 있음
  const myRole = isRoleCode(membership.role_code)       ? membership.role_code       : "MEMBER";
  const myJob  = isJobCode (membership.job_title_code)  ? membership.job_title_code  : "ETC";
  const myPlan = isPlanCode(membership.member.plan_code) ? membership.member.plan_code : "FREE";

  return apiSuccess({ myRole, myJob, myPlan });
}
