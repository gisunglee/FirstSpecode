/**
 * requirePermission — API Route 권한 가드 (한 줄로 끝나는 게이트)
 *
 * 역할:
 *   - 인증(JWT/API키) + 프로젝트 멤버십 + 권한 체크를 한 번에 처리
 *   - 성공 시 { mberId, email, role, job, plan, systemRole, viaSupportSession } 반환
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
 *
 * 시스템 관리자 처리:
 *   ① 자기 프로젝트 멤버인 경우
 *      - 기존 흐름 + hasPermission short-circuit 으로 전권 허용
 *   ② 자기 프로젝트 멤버가 아닌 경우 + 활성 지원 세션 있음
 *      - role='VIEWER' 로 대체, systemRole 은 actor 에 넣지 않음
 *        (short-circuit 막기 위해) → 읽기만 허용
 *      - 쓰기 권한 요청 시 "FORBIDDEN_SUPPORT_READONLY" 403
 *   ③ 자기 프로젝트 멤버가 아닌 경우 + 세션 없음
 *      - 시스템 관리자여도 403 (프라이버시 보호)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/apiResponse";
import { requireAuth, type AuthPayload } from "@/lib/requireAuth";
import { enforceMcpKeyScope } from "@/lib/mcpKeyScope";
import {
  hasPermission,
  explainPermission,
  isRoleCode,
  isJobCode,
  isPlanCode,
  isSystemRoleCode,
  type Permission,
  type RoleCode,
  type JobCode,
  type PlanCode,
  type SystemRoleCode,
} from "@/lib/permissions";

export type PermissionContext = AuthPayload & {
  role: RoleCode;
  job:  JobCode;
  plan: PlanCode;
  /** 시스템 관리자 여부 (일반 사용자는 null) */
  systemRole: SystemRoleCode | null;
  /** true면 지원 세션을 통해 진입한 상태 — API 에서 추가 로깅 등에 활용 */
  viaSupportSession: boolean;
};

// 쓰기성 권한 판정 — 지원 세션에서는 허용되지 않음
// 현재 PERMISSIONS 맵의 action suffix 를 확인하는 방식으로 단순 판정.
// ".read" 만 허용, 그 외(.create/update/delete/invite/remove/changeRole/manage/write/transfer 등)는 차단.
function isWritePermission(perm: Permission): boolean {
  // "*.read" 접미사 + "member.read" 같은 읽기만 허용
  return !perm.endsWith(".read");
}

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

  // ①-B MCP 키 scope 체크 — "프로젝트 고정" 키가 다른 프로젝트 건드리는 것 차단
  //     멤버십 조회 전에 먼저 걸러서 불필요한 DB 호출 방지.
  //     (MCP 키로는 시스템 관리자 권한을 쓸 수 없다 — JWT 세션에서만 유효)
  const scopeErr = enforceMcpKeyScope(auth, projectId);
  if (scopeErr) return scopeErr;  // 403 FORBIDDEN_SCOPE

  // ② 멤버십 + 멤버 플랜 + 시스템 역할 + 프로젝트 삭제 상태 조회 (한 번의 쿼리로)
  //
  // project.del_yn 을 함께 가져오는 이유:
  //   OWNER 가 프로젝트 삭제(soft delete) 를 요청한 뒤에는, 일반 사용자가
  //   해당 프로젝트의 어떤 API 도 호출할 수 없어야 한다. 권한 가드의
  //   진입점인 여기서 한 번에 막아 두면 거의 모든 API 가 자동 차폐된다.
  //   SUPER_ADMIN 의 지원 세션 경로는 아래 별도 분기에서 처리.
  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
    select: {
      role_code:       true,
      job_title_code:  true,
      mber_sttus_code: true,
      member: {
        select: {
          plan_code:     true,
          sys_role_code: true,
        },
      },
      project: {
        select: { del_yn: true },
      },
    },
  });

  // ─── 프로젝트가 "삭제 예정" 이면 일반 사용자는 진입 불가 ──────────
  //
  // del_yn='Y' 시점부터 hard delete 배치까지의 보관 기간 동안, OWNER 를
  // 포함한 모든 일반 멤버에게 해당 프로젝트는 "이미 사라진 것"으로
  // 보여야 한다. 복구는 별도의 restore API 로만 가능. 시스템 관리자는
  // 아래 지원 세션 분기에서 별도 처리.
  if (membership?.project?.del_yn === "Y") {
    return apiError(
      "FORBIDDEN_PROJECT_DELETED",
      "이 프로젝트는 삭제 처리되었습니다.",
      403
    );
  }

  // ─── 멤버십이 있는 정상 경로 ───────────────────────────────────────
  if (membership && membership.mber_sttus_code === "ACTIVE") {
    const role = isRoleCode(membership.role_code)           ? membership.role_code           : null;
    const job  = isJobCode (membership.job_title_code)      ? membership.job_title_code      : null;
    const plan = isPlanCode(membership.member.plan_code)    ? membership.member.plan_code    : "FREE";

    // 시스템 관리자 권한은 **로그인 세션(JWT)에서만** 유효.
    // MCP 키(auth.sesnId 없음)로는 sys_role_code 가 있어도 적용하지 않는다.
    // → 키 탈취 시 시스템 관리자 권한 우회 차단 (fail-secure)
    const systemRole = auth.sesnId && isSystemRoleCode(membership.member.sys_role_code)
      ? membership.member.sys_role_code
      : null;

    if (!role) {
      return apiError("FORBIDDEN", "유효하지 않은 역할 설정입니다.", 403);
    }

    const actor = { role, job, plan, systemRole };

    if (!hasPermission(actor, permission)) {
      const reason = explainPermission(actor, permission);
      return apiError(reason?.code ?? "FORBIDDEN", reason?.message ?? "권한이 없습니다.", 403);
    }

    return {
      mberId: auth.mberId,
      email:  auth.email,
      role,
      job:    job ?? "ETC",
      plan,
      systemRole,
      viaSupportSession: false,
    };
  }

  // ─── 멤버가 아닌 경우 — 시스템 관리자 + 활성 지원 세션이면 읽기만 허용 ─
  //
  // (멤버가 없거나 비활성) 상태에서만 이 분기 진입. API 키 인증일 때는
  // sys_role_code 로 우회 불가하도록 추가 조건(JWT 세션) 검사.
  if (!auth.sesnId) {
    // API 키 인증 → 시스템 관리자 우회 금지 (fail-secure)
    return apiError("FORBIDDEN", "프로젝트 멤버가 아닙니다.", 403);
  }

  const admin = await prisma.tbCmMember.findUnique({
    where:  { mber_id: auth.mberId },
    select: { sys_role_code: true, plan_code: true },
  });

  const adminSysRole = isSystemRoleCode(admin?.sys_role_code)
    ? admin!.sys_role_code
    : null;

  if (adminSysRole !== "SUPER_ADMIN") {
    return apiError("FORBIDDEN", "프로젝트 멤버가 아닙니다.", 403);
  }

  // 활성 지원 세션 확인 (한 건이라도 있으면 통과)
  const now = new Date();
  const activeSession = await prisma.tbSysAdminSupportSession.findFirst({
    where: {
      admin_mber_id: auth.mberId,
      prjct_id:      projectId,
      expires_dt:    { gt: now },
      ended_dt:      null,
    },
    select: { sess_id: true },
  });

  if (!activeSession) {
    return apiError(
      "FORBIDDEN_NO_SUPPORT_SESSION",
      "해당 프로젝트에 대한 지원 세션이 없습니다. /admin 에서 지원 세션을 시작해 주세요.",
      403
    );
  }

  // 쓰기 권한이면 차단 — 지원 세션은 읽기 전용 (원본 데이터 보호)
  if (isWritePermission(permission)) {
    return apiError(
      "FORBIDDEN_SUPPORT_READONLY",
      "지원 세션은 읽기 전용입니다. 변경이 필요하면 /admin 의 관리 API 를 이용해 주세요.",
      403
    );
  }

  // 읽기 권한은 VIEWER 로 통과 (hasPermission short-circuit 을 타지 않도록
  // systemRole 을 actor 에 넣지 않는다 — 읽기-쓰기 분리가 핵심)
  const plan = isPlanCode(admin!.plan_code) ? admin!.plan_code : "FREE";
  const viewerActor = { role: "VIEWER" as const, job: null, plan };

  if (!hasPermission(viewerActor, permission)) {
    return apiError("FORBIDDEN", "해당 리소스에 대한 읽기 권한이 없습니다.", 403);
  }

  return {
    mberId: auth.mberId,
    email:  auth.email,
    role:   "VIEWER",
    job:    "ETC",
    plan,
    systemRole: "SUPER_ADMIN",
    viaSupportSession: true,
  };
}
