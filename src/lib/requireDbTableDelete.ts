/**
 * requireDbTableDelete — DB 테이블 삭제 권한 게이트
 *
 * 통과 조건 (OR):
 *   ① db.table.delete 매트릭스 — OWNER/ADMIN 역할 또는 PM/PL/DBA 직무
 *   ② 본인이 해당 테이블의 담당자(asign_mber_id) — 매트릭스로 표현 못 하는 동적 조건
 *      (requireScheduleWrite / requirement.update 담당자 예외와 동일 관례)
 *
 * 단건 삭제는 requireDbTableDelete() 로 담당자 대조까지 한 번에 판정하고,
 * 일괄 삭제는 requireDbTableDeleteBase() 로 매트릭스 조건만 먼저 확인한 뒤
 * (멤버십 조회를 테이블 개수만큼 반복하지 않도록) 라우트에서 테이블별로
 * asign_mber_id 를 직접 대조한다.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { hasPermission, isRoleCode, isJobCode } from "@/lib/permissions";
import { apiError } from "@/lib/apiResponse";

export type DbTableDeleteBaseGate = { mberId: string; matrixOK: boolean };

// 인증 + 멤버십 + 매트릭스 조건만 판정 (담당자 대조는 호출부 책임)
export async function requireDbTableDeleteBase(
  request: NextRequest,
  projectId: string
): Promise<DbTableDeleteBaseGate | Response> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where:  { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
    select: { role_code: true, job_title_code: true, mber_sttus_code: true },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "프로젝트 멤버가 아닙니다.", 403);
  }

  const role = isRoleCode(membership.role_code)      ? membership.role_code      : null;
  const job  = isJobCode(membership.job_title_code)   ? membership.job_title_code : null;

  // plan 은 이 권한 규칙에 영향 없으므로 FREE 고정
  const matrixOK = hasPermission({ role, job, plan: "FREE", systemRole: null }, "db.table.delete");

  return { mberId: auth.mberId, matrixOK };
}

// 단건 삭제용 — 담당자 대조까지 한 번에 처리
export async function requireDbTableDelete(
  request: NextRequest,
  projectId: string,
  getAssigneeMberId: () => Promise<string | null>
): Promise<{ mberId: string } | Response> {
  const base = await requireDbTableDeleteBase(request, projectId);
  if (base instanceof Response) return base;
  if (base.matrixOK) return { mberId: base.mberId };

  const assigneeId = await getAssigneeMberId();
  if (assigneeId !== null && assigneeId === base.mberId) {
    return { mberId: base.mberId };
  }

  return apiError("FORBIDDEN", "이 테이블의 담당자이거나 PM/PL/DBA/관리자만 삭제할 수 있습니다.", 403);
}
