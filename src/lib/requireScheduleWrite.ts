/**
 * requireScheduleWrite — 설정 > 일정 탭(마일스톤/공휴일) 쓰기 권한 게이트
 *
 * 통과 조건 (OR):
 *   ① permissions 매트릭스 "schedule.manage" 통과 — OWNER/ADMIN 역할 또는 PM/PL 직무
 *   ② 본인이 해당 레코드를 등록한 사람(creat_mber_id) — 매트릭스로 표현 못 하는 동적 조건
 *
 * src/app/api/projects/[id]/requirements/[reqId]/route.ts 의 requireRequirementWrite와
 * 동일한 관례. 마일스톤·공휴일 두 리소스가 똑같은 OR 규칙을 쓰므로 여기 하나로 공유한다.
 *
 * 생성/일괄 처리처럼 "기존 레코드"가 없는 액션은 getCreatorMberId 를 생략하면
 * (또는 항상 null 반환) 매트릭스 조건만으로 판정된다.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { hasPermission, isRoleCode, isJobCode } from "@/lib/permissions";
import { apiError } from "@/lib/apiResponse";

export type ScheduleWriteGate = { mberId: string };

export async function requireScheduleWrite(
  request: NextRequest,
  projectId: string,
  getCreatorMberId?: () => Promise<string | null>
): Promise<ScheduleWriteGate | Response> {
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

  // ① 매트릭스 권한 체크 — plan 은 이 권한 규칙에 영향 없으므로 FREE 고정
  const matrixOK = hasPermission({ role, job, plan: "FREE", systemRole: null }, "schedule.manage");
  if (matrixOK) return { mberId: auth.mberId };

  // ② 본인이 등록한 항목인지 확인 (기존 레코드가 있는 수정/삭제에서만 사용)
  const creatorMberId = getCreatorMberId ? await getCreatorMberId() : null;
  if (creatorMberId !== null && creatorMberId === auth.mberId) {
    return { mberId: auth.mberId };
  }

  return apiError("FORBIDDEN", "이 항목을 등록한 사람이거나 PM/관리자만 처리할 수 있습니다.", 403);
}
