/**
 * Design Studio API adapter.
 *
 * No studio-specific server endpoint is introduced. Existing read/write contracts are
 * wrapped here so removing the studio never changes the underlying design features.
 */

import { authFetch } from "@/lib/authFetch";
import type { SpecContentPermissions } from "@/types/specContentPermissions";
import type {
  BlockDetail,
  DesignTreeResponse,
  RequirementDetail,
  RelatedCodesResponse,
  StudioBlock,
  StudioDraft,
  UnitWorkSummary,
} from "./types";

type ApiEnvelope<T> = { data: T };

export async function fetchUnitWorks(projectId: string): Promise<UnitWorkSummary[]> {
  const response = await authFetch<ApiEnvelope<{ items: UnitWorkSummary[] }>>(
    `/api/projects/${projectId}/unit-works`,
  );
  return response.data.items;
}

export async function fetchDesignTree(
  projectId: string,
  unitWorkId: string,
): Promise<DesignTreeResponse> {
  const response = await authFetch<ApiEnvelope<DesignTreeResponse>>(
    `/api/projects/${projectId}/design/tree?unitWorkIds=${encodeURIComponent(unitWorkId)}`,
  );
  return response.data;
}

export async function fetchRequirement(
  projectId: string,
  requirementId: string,
): Promise<RequirementDetail> {
  const response = await authFetch<ApiEnvelope<RequirementDetail>>(
    `/api/projects/${projectId}/requirements/${requirementId}`,
  );
  return response.data;
}

export async function fetchRelatedCodes(
  projectId: string,
  unitWorkId: string,
): Promise<RelatedCodesResponse> {
  const response = await authFetch<ApiEnvelope<RelatedCodesResponse>>(
    `/api/projects/${projectId}/design-studio/related-codes?unitWorkId=${encodeURIComponent(unitWorkId)}`,
  );
  return response.data;
}

function detailPath(projectId: string, block: StudioBlock): string {
  switch (block.kind) {
    case "requirement":
    case "analysis":
      return `/api/projects/${projectId}/requirements/${block.entityId}`;
    case "unitWork":
      return `/api/projects/${projectId}/unit-works/${block.entityId}`;
    case "screen":
      return `/api/projects/${projectId}/screens/${block.entityId}`;
    case "area":
      return `/api/projects/${projectId}/areas/${block.entityId}`;
    case "function":
      return `/api/projects/${projectId}/functions/${block.entityId}`;
  }
}

export async function fetchBlockPermissions(
  projectId: string,
  block: StudioBlock,
): Promise<SpecContentPermissions> {
  const response = await authFetch<ApiEnvelope<BlockDetail>>(detailPath(projectId, block));
  return response.data.permissions;
}

function requirementPayload(
  detail: RequirementDetail,
  updates: Partial<Pick<RequirementDetail, "name" | "currentContent" | "analysisMemo" | "detailSpec">>,
) {
  return {
    taskId: detail.taskId,
    name: updates.name ?? detail.name,
    priority: detail.priority,
    source: detail.source,
    rfpPage: detail.rfpPage,
    originalContent: detail.originalContent,
    currentContent: updates.currentContent ?? detail.currentContent,
    analysisMemo: updates.analysisMemo ?? detail.analysisMemo,
    detailSpec: updates.detailSpec ?? detail.detailSpec,
    reqDisplayId: detail.displayId,
    sortOrder: detail.sortOrder,
    assignMemberId: detail.assignMemberId,
    analysisStart: detail.analysisStart ?? undefined,
    analysisEnd: detail.analysisEnd ?? undefined,
    analysisEffort: detail.analysisEffort ?? undefined,
    progress: detail.progress,
  };
}

export async function saveStudioBlock(
  projectId: string,
  block: StudioBlock,
  draft: StudioDraft,
  requirement: RequirementDetail | undefined,
): Promise<void> {
  let body: Record<string, unknown>;

  switch (block.kind) {
    case "requirement":
      if (!requirement) throw new Error("요구사항 원본을 불러오지 못했습니다.");
      body = requirementPayload(requirement, {
        name: draft.name,
        currentContent: draft.description,
      });
      break;
    case "analysis":
      if (!requirement) throw new Error("상세분석 원본을 불러오지 못했습니다.");
      body = requirementPayload(requirement, {
        analysisMemo: draft.description,
        detailSpec: draft.secondaryDescription,
      });
      break;
    case "unitWork":
    case "area":
      body = { name: draft.name, description: draft.description };
      break;
    case "screen":
    case "function":
      body = { name: draft.name, description: draft.description };
      break;
  }

  await authFetch(detailPath(projectId, block), {
    method: "PUT",
    body: JSON.stringify(body),
  });
}
