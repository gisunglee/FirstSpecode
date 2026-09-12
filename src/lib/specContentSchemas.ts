import { z } from "zod";

import { SCOPE_STTUS, type ScopeSttusCode } from "@/lib/scopeStatus";

const requiredText = (message: string) => z.string().trim().min(1, message);
const optionalText = z.string().optional();
const optionalNullableText = z.string().nullable().optional();
const optionalOrder = z.number().int().min(0).optional();

// 사업 범위 구분 — 미지정이면 필드를 넘기지 않아 DB DEFAULT('NEW') 가 적용된다.
// 허용값을 SCOPE_STTUS 에서 끌어오므로 코드값이 늘어도 여기를 고칠 필요가 없다.
const SCOPE_STTUS_VALUES = Object.values(SCOPE_STTUS) as [ScopeSttusCode, ...ScopeSttusCode[]];
const optionalScopeStatus = z.enum(SCOPE_STTUS_VALUES).optional();
const acceptanceCriterion = z.object({
  given: optionalText,
  when: optionalText,
  then: optionalText,
}).strict();

export const taskCreateSchema = z.object({
  name: requiredText("과업명을 입력해 주세요."),
  category: requiredText("카테고리를 선택해 주세요."),
  definition: optionalText,
  content: optionalText,
  outputInfo: optionalText,
  rfpPage: optionalText,
  displayId: optionalText,
}).strict();

export const taskUpdateSchema = taskCreateSchema.extend({
  assignMemberId: optionalNullableText,
}).strict();

export const requirementCreateSchema = z.object({
  taskId: optionalNullableText,
  name: requiredText("요구사항명을 입력해 주세요."),
  displayId: optionalText,
  priority: requiredText("우선순위를 선택해 주세요."),
  source: requiredText("출처를 선택해 주세요."),
  rfpPage: optionalText,
  originalContent: optionalText,
  currentContent: optionalText,
  analysisMemo: optionalText,
  detailSpec: optionalText,
  scopeStatus: optionalScopeStatus,
}).strict();

export const requirementUpdateSchema = requirementCreateSchema.extend({
  reqDisplayId: optionalText,
  sortOrder: optionalOrder,
  assignMemberId: optionalNullableText,
  analysisStart: optionalText,
  analysisEnd: optionalText,
  analysisEffort: optionalText,
  progress: z.number().int().min(0).max(100).optional(),
  saveHistory: z.boolean().optional(),
  versionMode: z.enum(["major", "minor"]).optional(),
  versionComment: optionalText,
  saveSpecHistory: z.boolean().optional(),
  saveAnalyHistory: z.boolean().optional(),
}).strict();

export const userStoryCreateSchema = z.object({
  requirementId: requiredText("요구사항을 선택해 주세요."),
  name: requiredText("스토리명을 입력해 주세요."),
  persona: optionalText,
  scenario: optionalText,
  acceptanceCriteria: z.array(acceptanceCriterion).optional(),
}).strict();

export const userStoryUpdateSchema = userStoryCreateSchema.extend({
  persona: requiredText("페르소나를 입력해 주세요."),
  scenario: requiredText("시나리오를 입력해 주세요."),
}).strict();

export const unitWorkCreateSchema = z.object({
  reqId: requiredText("상위 요구사항을 선택해 주세요."),
  name: requiredText("단위업무명을 입력해 주세요."),
  displayId: optionalText,
  description: optionalText,
  assignMemberId: optionalNullableText,
  startDate: optionalText,
  endDate: optionalText,
  scopeStatus: optionalScopeStatus,
}).strict();

export const unitWorkUpdateSchema = z.object({
  name: requiredText("단위업무명을 입력해 주세요."),
  displayId: optionalText,
  description: optionalText,
  comment: optionalText,
  assignMemberId: optionalNullableText,
  planStartDate: optionalText,
  planEndDate: optionalText,
  planEffort: optionalText,
  docStatus: optionalText,
  sortOrder: optionalOrder,
  saveHistory: z.boolean().optional(),
  scopeStatus: optionalScopeStatus,
}).strict();

export const screenCreateSchema = z.object({
  unitWorkId: optionalNullableText,
  displayId: optionalText,
  name: requiredText("화면명을 입력해 주세요."),
  description: optionalText,
  assignMemberId: optionalNullableText,
  layoutData: optionalText,
  type: optionalText,
  categoryL: optionalText,
  categoryM: optionalText,
  categoryS: optionalText,
  scopeStatus: optionalScopeStatus,
}).strict();

export const screenUpdateSchema = z.object({
  unitWorkId: optionalNullableText,
  displayId: optionalText,
  name: optionalText,
  description: optionalText,
  comment: optionalText,
  type: optionalText,
  sortOrder: optionalOrder,
  categoryL: optionalText,
  categoryM: optionalText,
  categoryS: optionalText,
  layoutData: optionalText,
  saveHistory: z.boolean().optional(),
  assignMemberId: optionalNullableText,
  implBgngDe: optionalText,
  implEndDe: optionalText,
  docStatus: optionalText,
  scopeStatus: optionalScopeStatus,
}).strict();

export const areaCreateSchema = z.object({
  screenId: optionalNullableText,
  name: requiredText("영역명을 입력해 주세요."),
  type: optionalText,
  displayFormCode: optionalText,
  description: optionalText,
  sortOrder: optionalOrder,
  displayId: optionalText,
  scopeStatus: optionalScopeStatus,
}).strict();

export const areaUpdateSchema = areaCreateSchema.extend({
  layoutData: optionalText,
  commentCn: optionalText,
  saveHistory: z.boolean().optional(),
  docStatus: optionalText,
}).strict();

export const functionCreateSchema = z.object({
  areaId: optionalNullableText,
  displayId: optionalText,
  name: requiredText("기능명을 입력해 주세요."),
  type: optionalText,
  description: optionalText,
  priority: optionalText,
  complexity: optionalText,
  effort: optionalText,
  assignMemberId: optionalNullableText,
  sortOrder: optionalOrder,
  scopeStatus: optionalScopeStatus,
}).strict();

export const functionUpdateSchema = functionCreateSchema.partial().extend({
  commentCn: optionalText,
  docStatus: optionalText,
  saveHistory: z.boolean().optional(),
}).strict();

export const excalidrawUpdateSchema = z.object({
  data: z.unknown().refine((value) => value !== undefined, "Excalidraw 데이터가 필요합니다."),
}).strict();

export const unitWorkInlineSchema = z.object({
  field: z.enum(["assignee", "startDate", "endDate", "scopeStatus"]),
  value: z.string().nullable(),
}).strict();

export const screenInlineSchema = z.object({
  field: z.enum(["assignee", "scopeStatus"]),
  value: z.string().nullable(),
}).strict();

export const functionInlineSchema = z.object({
  field: z.enum(["complexity", "effort", "assignee", "scopeStatus"]),
  value: z.string().nullable(),
}).strict();

// 요구사항·영역은 원래 인라인 편집 대상이 없었다. 사업 범위 구분만 목록에서
// 바로 고칠 수 있어야 해서(AS-IS 대량 등록 후 정정) field 를 한 값으로 고정한 채 추가한다.
export const requirementInlineSchema = z.object({
  field: z.literal("scopeStatus"),
  value: z.string().nullable(),
}).strict();

export const areaInlineSchema = z.object({
  field: z.literal("scopeStatus"),
  value: z.string().nullable(),
}).strict();

export const requirementProgressSchema = z.object({
  progress: z.number().int().min(0).max(100),
}).strict();

export const requirementNameSchema = z.object({
  name: requiredText("요구사항명을 입력해 주세요."),
}).strict();

export const taskSortSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1),
}).strict();

const sortOrder = z.number().int().min(0);
const orderListSchema = <T extends z.ZodRawShape>(shape: T) => z.object({
  orders: z.array(z.object(shape).strict()).min(1),
}).strict();

export const requirementSortSchema = orderListSchema({ requirementId: z.string().min(1), sortOrder });
export const userStorySortSchema = orderListSchema({ storyId: z.string().min(1), sortOrder });
export const unitWorkSortSchema = orderListSchema({ unitWorkId: z.string().min(1), sortOrder });
export const screenSortSchema = orderListSchema({ screenId: z.string().min(1), sortOrder });
export const areaSortSchema = orderListSchema({ areaId: z.string().min(1), sortOrder });
export const functionSortSchema = orderListSchema({ funcId: z.string().min(1), sortOrder });
