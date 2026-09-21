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
  analysis: "상세명세",
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
  colMappingCount: number;
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
  colMappingCount?: number;
};

export type StudioDraft = {
  name: string;
  description: string;
  secondaryDescription: string;
};

export type BlockDetail = {
  permissions: SpecContentPermissions;
};

export type RelatedCodeSource = {
  mappingId: string;
  mappingGroupName: string;
  tableId: string;
  tableName: string;
  tableLogicalName: string;
  columnId: string;
  columnName: string;
  columnLogicalName: string;
  ioType: string;
  purpose: string;
};

export type RelatedCodeGroup = {
  groupCode: string;
  groupName: string;
  description: string;
  useYn: string;
  exists: boolean;
  codes: Array<{
    codeId: number;
    code: string;
    name: string;
    description: string;
    useYn: string;
  }>;
};

export type RelatedDbTable = {
  tableId: string;
  tableName: string;
  tableLogicalName: string;
  functionIds: string[];
};

export type RelatedFunctionCode = {
  functionId: string;
  displayId: string;
  name: string;
  areaId: string;
  screenId: string;
  mappingCount: number;
  codeGroups: Array<{
    groupCode: string;
    sources: RelatedCodeSource[];
  }>;
};

export type RelatedCodesResponse = {
  unitWorkId: string;
  loadedAt: string;
  summary: {
    functionCount: number;
    mappedFunctionCount: number;
    mappingCount: number;
    codeGroupCount: number;
    tableCount: number;
  };
  codeGroups: RelatedCodeGroup[];
  dbTables: RelatedDbTable[];
  functions: RelatedFunctionCode[];
};

/** 관련 정보 패널 — 단위업무에 연결된 테스트 명세 (GET /api/projects/[id]/test-specs?unitWorkId=) */
export type RelatedTestSpec = {
  testSpecId: string;
  displayId: string;
  /** UNIT | INTEGRATION */
  testKindCode: string;
  testSpecNm: string;
  /** DRAFT | IN_PROGRESS | PASSED | FAILED */
  sttusCode: string;
  /** 이 명세가 덮는 화면 — 현재 문서가 화면이면 포함 여부로 굵기 표시 */
  screens: Array<{ screenId: string; displayId: string | null; name: string | null }>;
  caseCount: number;
  roundCount: number;
};
