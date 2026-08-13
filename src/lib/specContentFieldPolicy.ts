import type { SpecResourceType, SpecWriteGrant } from "./specContentPolicyCore";

const CREATOR_FIELDS: Record<SpecResourceType, readonly string[]> = {
  TASK: ["name", "category", "definition", "content", "outputInfo", "rfpPage"],
  REQUIREMENT: [
    "name", "priority", "source", "rfpPage", "originalContent", "currentContent",
    "analysisMemo", "detailSpec", "saveHistory", "versionMode", "versionComment",
    "saveSpecHistory", "saveAnalyHistory",
  ],
  USER_STORY: ["name", "persona", "scenario", "acceptanceCriteria"],
  UNIT_WORK: ["name", "description", "comment", "saveHistory"],
  SCREEN: [
    "name", "description", "comment", "type", "categoryL", "categoryM", "categoryS",
    "layoutData", "saveHistory",
  ],
  AREA: [
    "name", "type", "displayFormCode", "description", "layoutData", "excalidrawData", "commentCn", "saveHistory",
  ],
  FUNCTION: ["name", "type", "description", "commentCn", "priority", "saveHistory"],
};

const ASSIGNEE_FIELDS: Record<SpecResourceType, readonly string[]> = {
  TASK: CREATOR_FIELDS.TASK,
  REQUIREMENT: [...CREATOR_FIELDS.REQUIREMENT, "analysisStart", "analysisEnd", "analysisEffort", "progress"],
  USER_STORY: CREATOR_FIELDS.USER_STORY,
  UNIT_WORK: [...CREATOR_FIELDS.UNIT_WORK, "planStartDate", "planEndDate", "planEffort", "docStatus"],
  SCREEN: [...CREATOR_FIELDS.SCREEN, "implBgngDe", "implEndDe", "docStatus"],
  AREA: [...CREATOR_FIELDS.AREA, "docStatus"],
  FUNCTION: [...CREATOR_FIELDS.FUNCTION, "complexity", "effort", "docStatus"],
};

const MEMBER_CREATE_FIELDS: Record<SpecResourceType, readonly string[]> = {
  TASK: ["name", "category", "definition", "content", "outputInfo", "rfpPage"],
  REQUIREMENT: [
    "taskId", "name", "priority", "source", "rfpPage", "originalContent", "currentContent",
    "analysisMemo", "detailSpec",
  ],
  USER_STORY: ["requirementId", "name", "persona", "scenario", "acceptanceCriteria"],
  UNIT_WORK: ["reqId", "name", "description"],
  SCREEN: ["unitWorkId", "name", "description", "layoutData", "type", "categoryL", "categoryM", "categoryS"],
  AREA: ["screenId", "name", "type", "displayFormCode", "description"],
  FUNCTION: ["areaId", "name", "type", "description", "priority"],
};

export type SpecFieldPolicyResult = {
  code: "FORBIDDEN_CREATOR_FIELD" | "FORBIDDEN_MANAGER_ONLY_FIELD";
  message: string;
  restrictedFields: string[];
} | null;

/** 실제로 값이 달라진 필드를 grant별 allow-list와 대조한다. */
export function checkSpecChangedFields(
  resourceType: SpecResourceType,
  grant: SpecWriteGrant,
  changedFields: readonly string[]
): SpecFieldPolicyResult {
  if (grant === "MANAGER") return null;

  const allowed = new Set(grant === "CREATOR_WINDOW"
    ? CREATOR_FIELDS[resourceType]
    : ASSIGNEE_FIELDS[resourceType]);
  const restrictedFields = [...new Set(changedFields)].filter((field) => !allowed.has(field));
  if (restrictedFields.length === 0) return null;

  if (grant === "CREATOR_WINDOW") {
    return {
      code: "FORBIDDEN_CREATOR_FIELD",
      message: `생성 후 30분 보정 권한으로 변경할 수 없는 필드입니다: ${restrictedFields.join(", ")}`,
      restrictedFields,
    };
  }

  return {
    code: "FORBIDDEN_MANAGER_ONLY_FIELD",
    message: `담당자가 변경할 수 없는 구조·권한 필드입니다. OWNER/ADMIN 또는 PM/PL에게 요청해 주세요: ${restrictedFields.join(", ")}`,
    restrictedFields,
  };
}

export function checkSpecCreateFields(
  resourceType: SpecResourceType,
  manager: boolean,
  submittedFields: readonly string[]
): SpecFieldPolicyResult {
  if (manager) return null;

  const allowed = new Set(MEMBER_CREATE_FIELDS[resourceType]);
  const restrictedFields = [...new Set(submittedFields)].filter((field) => !allowed.has(field));
  if (restrictedFields.length === 0) return null;

  return {
    code: "FORBIDDEN_MANAGER_ONLY_FIELD",
    message: `일반 멤버는 생성하면서 담당자·일정·표시 ID·정렬 같은 관리 필드를 지정할 수 없습니다: ${restrictedFields.join(", ")}`,
    restrictedFields,
  };
}

export function listMeaningfulFields(
  values: Record<string, unknown>,
  emptyValues: readonly unknown[] = [undefined, null, ""]
): string[] {
  return Object.entries(values)
    .filter(([, value]) => !emptyValues.includes(value))
    .map(([field]) => field);
}
