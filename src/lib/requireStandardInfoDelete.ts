/**
 * requireStandardInfoDelete — 기준 정보 삭제 권한 게이트
 *
 * 통과 조건 (OR):
 *   ① standardInfo.delete 매트릭스 — OWNER/ADMIN 역할 또는 PM/PL 직무
 *   ② 본인이 등록한 항목(creat_mber_id) — 매트릭스로 표현 못 하는 동적 조건
 *      (requireCodeDelete / requireDbTableDelete 와 동일 관례)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { hasPermission, isRoleCode, isJobCode } from "@/lib/permissions";
import { apiError } from "@/lib/apiResponse";

export async function requireStandardInfoDelete(
  request: NextRequest,
  projectId: string,
  getCreatorMberId: () => Promise<string | null>
): Promise<{ mberId: string } | Response> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where:  { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
    select: { role_code: true, job_title_code: true, mber_sttus_code: true },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "프로젝트 멤버가 아닙니다.", 403);
  }

  const role = isRoleCode(membership.role_code)     ? membership.role_code     : null;
  const job  = isJobCode(membership.job_title_code) ? membership.job_title_code : null;

  // plan 은 이 권한 규칙에 영향 없으므로 FREE 고정
  const matrixOK = hasPermission({ role, job, plan: "FREE", systemRole: null }, "standardInfo.delete");
  if (matrixOK) return { mberId: auth.mberId };

  const creatorId = await getCreatorMberId();
  if (creatorId !== null && creatorId === auth.mberId) {
    return { mberId: auth.mberId };
  }

  return apiError("FORBIDDEN", "등록자이거나 PM/PL/관리자만 삭제할 수 있습니다.", 403);
}
