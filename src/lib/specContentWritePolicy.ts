/**
 * 핵심 스펙 엔티티 쓰기 권한의 단일 정책.
 *
 * 우선순위:
 *   1. VIEWER는 직무와 무관하게 항상 읽기 전용
 *   2. OWNER/ADMIN, PM/PL은 관리자로서 수정/삭제 가능
 *   3. 수정은 가장 가까운 담당자에게 허용
 *   4. 생성자는 생성 후 30분 동안, 다른 사람이 먼저 수정하지 않은 경우에만 보정 가능
 *   5. 삭제는 관리자만 가능 (휴지통/복구 정책 도입 전의 보수적 기본값)
 */

import { NextRequest } from "next/server";
import { apiError } from "@/lib/apiResponse";
import { requirePermission, type PermissionContext } from "@/lib/requirePermission";
import {
  decideSpecContentWrite,
  isSpecManager,
  type SpecResourceType,
  type SpecWriteGrant,
} from "@/lib/specContentPolicyCore";
import {
  checkSpecChangedFields,
  checkSpecCreateFields,
  type SpecFieldPolicyResult,
} from "@/lib/specContentFieldPolicy";
import { findSpecResourcePolicyFacts } from "@/lib/specContentResourceResolver";

export { SPEC_CREATOR_EDIT_WINDOW_MS } from "@/lib/specContentPolicyCore";
export type { SpecResourceType, SpecWriteGrant } from "@/lib/specContentPolicyCore";

export type SpecWriteContext = PermissionContext & {
  grant: SpecWriteGrant;
  effectiveAssigneeId: string | null;
  creatorWindowExpiresAt: Date | null;
  policyCheckedAt: Date;
};

export type SpecContentCapabilities = {
  canEdit: boolean;
  canDelete: boolean;
  grant: SpecWriteGrant | null;
  reasonCode: string | null;
  reasonMessage: string | null;
  creatorWindowExpiresAt: string | null;
};

function fieldPolicyError(result: SpecFieldPolicyResult): Response | null {
  if (!result) return null;
  return apiError(result.code, result.message, 403, { restrictedFields: result.restrictedFields });
}

export function requireSpecChangedFields(
  gate: SpecWriteContext,
  resourceType: SpecResourceType,
  changedFields: readonly string[]
): Response | null {
  return fieldPolicyError(checkSpecChangedFields(resourceType, gate.grant, changedFields));
}

export function requireSpecCreateFields(
  context: PermissionContext,
  resourceType: SpecResourceType,
  submittedFields: readonly string[]
): Response | null {
  return fieldPolicyError(checkSpecCreateFields(resourceType, isSpecManager(context), submittedFields));
}

export function creatorWindowConflict(): Response {
  return apiError(
    "FORBIDDEN_CREATOR_WINDOW_CLOSED",
    "생성자 보정 시간이 만료되었거나 다른 사용자가 먼저 수정했습니다. 최신 내용을 다시 확인해 주세요.",
    403
  );
}

/** 여러 항목을 동시에 바꾸는 정렬·이동 같은 구조 변경용 게이트. */
export async function requireSpecManager(
  request: NextRequest,
  projectId: string
): Promise<PermissionContext | Response> {
  const context = await requirePermission(request, projectId, "content.read");
  if (context instanceof Response) return context;

  if (context.role === "VIEWER") {
    return apiError(
      "FORBIDDEN_VIEWER_READONLY",
      "뷰어는 읽기만 가능합니다. 수정하려면 프로젝트 역할을 MEMBER 이상으로 변경해 주세요.",
      403
    );
  }
  if (!isSpecManager(context)) {
    return apiError(
      "FORBIDDEN_MANAGER_ONLY",
      "정렬·이동·담당자 변경 같은 구조 변경은 OWNER/ADMIN 또는 PM/PL만 할 수 있습니다.",
      403
    );
  }
  return context;
}

export async function requireSpecContentWrite(
  request: NextRequest,
  projectId: string,
  resourceType: SpecResourceType,
  resourceId: string,
  action: "UPDATE" | "DELETE" = "UPDATE"
): Promise<SpecWriteContext | Response> {
  const context = await requirePermission(request, projectId, "content.read");
  if (context instanceof Response) return context;
  const resource = await findSpecResourcePolicyFacts(resourceType, resourceId);
  const policyCheckedAt = new Date();
  const decision = decideSpecContentWrite(context, projectId, resource, action, policyCheckedAt);
  if (!decision.allowed) {
    return apiError(
      decision.code,
      decision.message,
      decision.status,
      decision.creatorWindowExpiresAt
        ? { creatorWindowExpiresAt: decision.creatorWindowExpiresAt.toISOString() }
        : undefined
    );
  }

  return {
    ...context,
    grant: decision.grant,
    effectiveAssigneeId: decision.effectiveAssigneeId,
    creatorWindowExpiresAt: decision.creatorWindowExpiresAt,
    policyCheckedAt,
  };
}

/** 상세 조회 응답에서 웹 UI가 서버와 같은 버튼 상태를 사용하도록 제공한다. */
export async function getSpecContentCapabilities(
  request: NextRequest,
  projectId: string,
  resourceType: SpecResourceType,
  resourceId: string,
  existingContext?: PermissionContext
): Promise<SpecContentCapabilities> {
  if (existingContext) {
    const resource = await findSpecResourcePolicyFacts(resourceType, resourceId);
    const decision = decideSpecContentWrite(existingContext, projectId, resource, "UPDATE");
    if (decision.allowed) {
      return {
        canEdit: true,
        canDelete: decision.grant === "MANAGER",
        grant: decision.grant,
        reasonCode: null,
        reasonMessage: null,
        creatorWindowExpiresAt: decision.creatorWindowExpiresAt?.toISOString() ?? null,
      };
    }
    return {
      canEdit: false,
      canDelete: false,
      grant: null,
      reasonCode: decision.code,
      reasonMessage: decision.message,
      creatorWindowExpiresAt: decision.creatorWindowExpiresAt?.toISOString() ?? null,
    };
  }

  const gate = await requireSpecContentWrite(request, projectId, resourceType, resourceId);
  if (!(gate instanceof Response)) {
    return {
      canEdit: true,
      canDelete: gate.grant === "MANAGER",
      grant: gate.grant,
      reasonCode: null,
      reasonMessage: null,
      creatorWindowExpiresAt: gate.creatorWindowExpiresAt?.toISOString() ?? null,
    };
  }

  let payload: { code?: string; message?: string } = {};
  try {
    payload = await gate.clone().json() as { code?: string; message?: string };
  } catch {
    // 권한 응답 파싱 실패 시에도 UI는 fail-closed로 편집을 숨긴다.
  }
  return {
    canEdit: false,
    canDelete: false,
    grant: null,
    reasonCode: payload.code ?? "FORBIDDEN",
    reasonMessage: payload.message ?? "수정 권한이 없습니다.",
    creatorWindowExpiresAt: null,
  };
}
