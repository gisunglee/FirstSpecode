/**
 * taskWriteGate — 과업 등록/수정/삭제 권한 단일 게이트
 *
 * 역할:
 *   - POST/PUT/DELETE/sort/copy 라우트에서 동일한 규칙으로 호출
 *   - 인증(JWT/API키) + 프로젝트 멤버십 + "쓰기 가능 여부" 판정을 한 번에
 *
 * 통과 조건 (OR — 하나라도 만족하면 허용):
 *   ① 시스템 관리자(SUPER_ADMIN) — JWT 세션 한정
 *   ② 매트릭스 권한 통과 — OWNER/ADMIN 역할 OR PM/PL 직무
 *      (permissions.ts 의 "requirement.update" 규칙을 그대로 차용)
 *   ③ 본인이 해당 과업의 담당자(asign_mber_id) — taskId 가 주어진 경우만
 *   ④ 환경설정 MEMBER_TASK_UPT_PSBL_YN === "Y" + 본인이 MEMBER
 *      → 프로젝트 단위로 멤버에게 과업 편집을 임시 허용하는 옵트인 옵션
 *
 * 지원 세션(시스템 관리자가 다른 프로젝트에 진입한 상태)은 항상 차단
 * — 쓰기 작업이므로 requirePermission 의 isWritePermission 정책과 동일.
 *
 * 반환:
 *   { mberId } — 성공
 *   Response   — 401/403 (호출부는 instanceof 체크)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/apiResponse";
import { requireAuth } from "@/lib/requireAuth";
import { enforceMcpKeyScope } from "@/lib/mcpKeyScope";
import {
  hasPermission,
  isRoleCode,
  isJobCode,
  isSystemRoleCode,
  type RoleCode,
  type JobCode,
} from "@/lib/permissions";

// 환경설정 키 — 프로젝트별로 "MEMBER 도 과업 편집 가능" 여부를 토글
export const TASK_MEMBER_EDIT_CONFIG_KEY = "MEMBER_TASK_UPT_PSBL_YN";

/**
 * 과업 쓰기 게이트.
 *
 * @param request   NextRequest
 * @param projectId 대상 프로젝트
 * @param options.taskId 편집/삭제 대상 과업 — 본인 담당 여부 판정에 사용 (생성 시 생략)
 */
export async function requireTaskWrite(
  request: NextRequest,
  projectId: string,
  options?: { taskId?: string }
): Promise<{ mberId: string } | Response> {
  // ① 인증
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  // ①-B MCP 키 scope — 프로젝트 고정 키 보호
  const scopeErr = enforceMcpKeyScope(auth, projectId);
  if (scopeErr) return scopeErr;

  // ② 멤버십 + 시스템 역할
  const membership = await prisma.tbPjProjectMember.findUnique({
    where:  { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
    select: {
      role_code:       true,
      job_title_code:  true,
      mber_sttus_code: true,
      member: { select: { sys_role_code: true } },
    },
  });

  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    // 지원 세션 등 멤버 외 진입은 쓰기 차단 (요건상 과업 수정은 멤버 한정)
    return apiError("FORBIDDEN", "프로젝트 멤버가 아닙니다.", 403);
  }

  // 시스템 관리자 short-circuit — JWT 세션 한정 (API 키로는 우회 불가)
  // 자기 프로젝트의 ACTIVE 멤버여야 적용 (지원 세션은 멤버가 아니므로 위에서 이미 차단됨)
  if (
    !!auth.sesnId &&
    isSystemRoleCode(membership.member.sys_role_code) &&
    membership.member.sys_role_code === "SUPER_ADMIN"
  ) {
    return { mberId: auth.mberId };
  }

  const role: RoleCode | null = isRoleCode(membership.role_code)      ? membership.role_code      : null;
  const job:  JobCode  | null = isJobCode(membership.job_title_code)  ? membership.job_title_code : null;

  // ③ 매트릭스 권한 — OWNER/ADMIN 역할 OR PM/PL 직무
  //   plan 은 이 규칙에 영향 없으므로 FREE 고정
  const matrixOK = hasPermission(
    { role, job, plan: "FREE", systemRole: null },
    "requirement.update"
  );
  if (matrixOK) return { mberId: auth.mberId };

  // ④ 본인이 담당자인지 — taskId 가 있을 때만
  if (options?.taskId) {
    const existing = await prisma.tbRqTask.findUnique({
      where:  { task_id: options.taskId },
      select: { asign_mber_id: true, prjct_id: true },
    });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "과업을 찾을 수 없습니다.", 404);
    }
    if (existing.asign_mber_id === auth.mberId) {
      return { mberId: auth.mberId };
    }
  }

  // ⑤ 프로젝트 환경설정 옵트인 — MEMBER 에 한해 과업 편집 허용
  //   VIEWER 는 어떤 설정이어도 읽기 전용 (요건상 "나머지는 읽기만")
  if (role === "MEMBER") {
    const cfg = await prisma.tbPjProjectConfig.findUnique({
      where:  {
        prjct_id_config_key: { prjct_id: projectId, config_key: TASK_MEMBER_EDIT_CONFIG_KEY },
      },
      select: { config_value: true },
    });
    if (cfg?.config_value === "Y") return { mberId: auth.mberId };
  }

  return apiError(
    "FORBIDDEN_ROLE",
    "이 작업을 수행할 권한이 없습니다. (OWNER/ADMIN 또는 PM/PL 직무, 또는 본인 담당 과업만 가능)",
    403
  );
}
