/**
 * Design Studio client types.
 *
 * The studio deliberately owns a small view model instead of importing page-specific
 * types. That keeps the workspace removable and isolates API response changes here.
 */

import type { SpecContentPermissions } from "@/types/specContentPermissions";

export const STUDIO_KINDS = [
  "requirement",
  "analysis",
  "unitWork",
  "screen",
  "area",
  "function",
] as const;

export type StudioKind = (typeof STUDIO_KINDS)[number];

export const STUDIO_KIND_LABEL: Record<StudioKind, string> = {
  requirement: "요구사항",
  analysis: "상세분석",
  unitWork: "단위업무",
  screen: "화면",
  area: "영역",
  function: "기능",
};

export const STUDIO_KIND_CODE: Record<StudioKind, string> = {
  requirement: "REQ",
  analysis: "ANL",
  unitWork: "UW",
  screen: "SCR",
  area: "AREA",
  function: "FN",
};

export type UnitWorkSummary = {
  unitWorkId: string;
  displayId: string;
  name: string;
  description: string;
  reqId: string;
  reqDisplayId: string;
  reqName: string;
  assignMemberName: string | null;
  docStatus: string;
  modifiedAt: string;
  screenCount: number;
};

export type DesignFunctionNode = {
  functionId: string;
  displayId: string;
  name: string;
  description: string;
  type: string;
  scopeStatus: string;
};

export type DesignAreaNode = {
  areaId: string;
  displayId: string;
  name: string;
  description: string;
  type: string;
  scopeStatus: string;
  functions: DesignFunctionNode[];
};

export type DesignScreenNode = {
  screenId: string;
  displayId: string;
  name: string;
  description: string;
  type: string;
  scopeStatus: string;
  areas: DesignAreaNode[];
};

export type DesignUnitWorkNode = {
  unitWorkId: string;
  displayId: string;
  name: string;
  description: string;
  reqId: string;
  scopeStatus: string;
  screens: DesignScreenNode[];
};

export type DesignTreeResponse = {
  unitWorks: DesignUnitWorkNode[];
  requestedCount: number;
  foundCount: number;
  notFoundIds: string[];
};

export type RequirementDetail = {
  requirementId: string;
  displayId: string;
  name: string;
  priority: string;
  source: string;
  rfpPage: string;
  originalContent: string;
  currentContent: string;
  analysisMemo: string;
  detailSpec: string;
  taskId: string | null;
  taskName: string;
  assignMemberId: string | null;
  assignMemberName: string | null;
  sortOrder: number;
  analysisStart: string | null;
  analysisEnd: string | null;
  analysisEffort: string | null;
  progress: number;
  permissions: SpecContentPermissions;
};

export type StudioBlock = {
  key: string;
  entityId: string;
  kind: StudioKind;
  displayId: string;
  name: string;
  description: string;
  secondaryDescription?: string;
  parentKey: string | null;
  depth: number;
  sourceHref: string;
  format: "markdown" | "html";
};

export type StudioDraft = {
  name: string;
  description: string;
  secondaryDescription: string;
};

export type BlockDetail = {
  permissions: SpecContentPermissions;
};

