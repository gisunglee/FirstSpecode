import type { JobCode, RoleCode, SystemRoleCode } from "./permissions";

export const SPEC_CREATOR_EDIT_WINDOW_MS = 30 * 60 * 1000;

export type SpecResourceType =
  | "TASK"
  | "REQUIREMENT"
  | "USER_STORY"
  | "UNIT_WORK"
  | "SCREEN"
  | "AREA"
  | "FUNCTION";

export type SpecWriteAction = "UPDATE" | "DELETE";
export type SpecWriteGrant = "MANAGER" | "ASSIGNEE" | "CREATOR_WINDOW";

export type SpecPolicyActor = {
  mberId: string;
  systemRole: SystemRoleCode | null;
  role: RoleCode;
  job: JobCode;
};

export type SpecResourcePolicyFacts = {
  projectId: string;
  resourceName: string;
  creatorId: string | null;
  modifierId: string | null;
  createdAt: Date;
  assigneeChain: Array<string | null>;
};

export type SpecPolicyDecision =
  | {
      allowed: true;
      grant: SpecWriteGrant;
      effectiveAssigneeId: string | null;
      creatorWindowExpiresAt: Date | null;
    }
  | {
      allowed: false;
      code: string;
      message: string;
      status: 403 | 404;
      creatorWindowExpiresAt?: Date;
    };

export function isSpecManager(
  context: Pick<SpecPolicyActor, "systemRole" | "role" | "job">
): boolean {
  return (
    context.systemRole === "SUPER_ADMIN" ||
    context.role === "OWNER" ||
    context.role === "ADMIN" ||
    context.job === "PM" ||
    context.job === "PL"
  );
}

/** DB·HTTP와 독립적인 핵심 권한 결정 함수. */
export function decideSpecContentWrite(
  context: SpecPolicyActor,
  expectedProjectId: string,
  resource: SpecResourcePolicyFacts | null,
  action: SpecWriteAction = "UPDATE",
  now = new Date()
): SpecPolicyDecision {
  if (context.role === "VIEWER") {
    return {
      allowed: false,
      code: "FORBIDDEN_VIEWER_READONLY",
      message: "뷰어는 읽기만 가능합니다. 수정하려면 프로젝트 역할을 MEMBER 이상으로 변경해 주세요.",
      status: 403,
    };
  }

  if (!resource || resource.projectId !== expectedProjectId) {
    return {
      allowed: false,
      code: "NOT_FOUND",
      message: "수정할 스펙 항목을 찾을 수 없습니다.",
      status: 404,
    };
  }

  const effectiveAssigneeId = resource.assigneeChain.find((id): id is string => Boolean(id)) ?? null;
  const manager = isSpecManager(context);

  if (action === "DELETE") {
    if (!manager) {
      return {
        allowed: false,
        code: "FORBIDDEN_DELETE_MANAGER_ONLY",
        message: `${resource.resourceName} 삭제는 OWNER/ADMIN 또는 PM/PL만 할 수 있습니다. 잘못 등록한 항목은 관리자에게 삭제를 요청해 주세요.`,
        status: 403,
      };
    }
    return { allowed: true, grant: "MANAGER", effectiveAssigneeId, creatorWindowExpiresAt: null };
  }

  if (manager) {
    return { allowed: true, grant: "MANAGER", effectiveAssigneeId, creatorWindowExpiresAt: null };
  }

  if (effectiveAssigneeId === context.mberId) {
    return { allowed: true, grant: "ASSIGNEE", effectiveAssigneeId, creatorWindowExpiresAt: null };
  }

  const creatorWindowExpiresAt = resource.creatorId
    ? new Date(resource.createdAt.getTime() + SPEC_CREATOR_EDIT_WINDOW_MS)
    : null;
  const isCreator = resource.creatorId === context.mberId;
  const withinCreatorWindow = creatorWindowExpiresAt !== null && creatorWindowExpiresAt > now;
  const untouchedByAnotherMember = !resource.modifierId || resource.modifierId === context.mberId;

  if (isCreator && withinCreatorWindow && untouchedByAnotherMember) {
    return {
      allowed: true,
      grant: "CREATOR_WINDOW",
      effectiveAssigneeId,
      creatorWindowExpiresAt,
    };
  }

  if (isCreator && !untouchedByAnotherMember) {
    return {
      allowed: false,
      code: "FORBIDDEN_CREATOR_WINDOW_CLOSED",
      message: `다른 사용자가 이미 이 ${resource.resourceName}을(를) 수정하여 생성자 보정 시간이 종료되었습니다. 현재 담당자 또는 PM/PL에게 수정을 요청해 주세요.`,
      status: 403,
    };
  }

  if (isCreator && !withinCreatorWindow) {
    return {
      allowed: false,
      code: "CREATOR_WINDOW_EXPIRED",
      message: `생성 후 30분의 보정 시간이 지났습니다. 현재 담당자 또는 PM/PL에게 ${resource.resourceName} 수정을 요청해 주세요.`,
      status: 403,
      ...(creatorWindowExpiresAt ? { creatorWindowExpiresAt } : {}),
    };
  }

  if (effectiveAssigneeId) {
    return {
      allowed: false,
      code: "FORBIDDEN_NOT_ASSIGNEE",
      message: `이 ${resource.resourceName}의 담당자가 아닙니다. 가장 가까운 상위 담당자 또는 PM/PL만 수정할 수 있습니다.`,
      status: 403,
    };
  }

  return {
    allowed: false,
    code: "FORBIDDEN_NO_ASSIGNEE",
    message: `이 ${resource.resourceName}과(와) 상위 항목에 담당자가 없습니다. PM/PL 또는 프로젝트 관리자가 담당자를 지정한 뒤 수정할 수 있습니다.`,
    status: 403,
  };
}
