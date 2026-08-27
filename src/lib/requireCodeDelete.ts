/**
 * requireCodeDelete — 공통코드(그룹/코드) 삭제 권한 게이트
 *
 * 통과 조건 (OR):
 *   ① code.delete 매트릭스 — OWNER/ADMIN 역할 또는 PM/PL 직무
 *   ② 본인이 등록한 항목(creat_mber_id) — 매트릭스로 표현 못 하는 동적 조건
 *      (requireDbTableDelete 의 담당자 예외와 동일 관례 — 여기선 담당자 대신 등록자)
 *
 * 그룹 삭제와 코드(그룹 하위 항목) 삭제가 같은 code.delete 권한을 쓰므로
 * 베이스 판정 함수 하나를 공유하고, 등록자 대조만 호출부에서 대상별로 넘긴다.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { hasPermission, isRoleCode, isJobCode } from "@/lib/permissions";
import { apiError } from "@/lib/apiResponse";

export type CodeDeleteBaseGate = { mberId: string; matrixOK: boolean };

// 인증 + 멤버십 + 매트릭스 조건만 판정 (등록자 대조는 호출부 책임)
export async function requireCodeDeleteBase(
  request: NextRequest,
  projectId: string
): Promise<CodeDeleteBaseGate | Response> {
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
  const matrixOK = hasPermission({ role, job, plan: "FREE", systemRole: null }, "code.delete");

  return { mberId: auth.mberId, matrixOK };
}

// 단건 삭제용 — 등록자 대조까지 한 번에 처리
export async function requireCodeDelete(
  request: NextRequest,
  projectId: string,
  getCreatorMberId: () => Promise<string | null>
): Promise<{ mberId: string } | Response> {
  const base = await requireCodeDeleteBase(request, projectId);
  if (base instanceof Response) return base;
  if (base.matrixOK) return { mberId: base.mberId };

  const creatorId = await getCreatorMberId();
  if (creatorId !== null && creatorId === base.mberId) {
    return { mberId: base.mberId };
  }

  return apiError("FORBIDDEN", "등록자이거나 PM/PL/관리자만 삭제할 수 있습니다.", 403);
}
