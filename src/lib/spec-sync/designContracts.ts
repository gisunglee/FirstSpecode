/** 실행 시점에 고정하는 설계 대상과 전체 snapshot 계약. */

import { z } from "zod";

export const TARGET_FIELDS = {
  UNIT_WORK: "unit_work_dc",
  SCREEN: "scrn_dc",
  AREA: "area_dc",
  FUNCTION: "func_dc",
} as const;

export const syncTargetTypeSchema = z.enum([
  "UNIT_WORK",
  "SCREEN",
  "AREA",
  "FUNCTION",
]);
export type SyncTargetType = z.infer<typeof syncTargetTypeSchema>;

export const syncTargetFieldSchema = z.enum([
  "unit_work_dc",
  "scrn_dc",
  "area_dc",
  "func_dc",
]);
export type SyncTargetField = z.infer<typeof syncTargetFieldSchema>;

const hierarchySchema = z.object({
  unitWorkId: z.string().trim().min(1).max(36),
  screenId: z.string().trim().min(1).max(36).nullable().default(null),
  areaId: z.string().trim().min(1).max(36).nullable().default(null),
  functionId: z.string().trim().min(1).max(36).nullable().default(null),
});

export const designTargetSchema = z
  .object({
    targetType: syncTargetTypeSchema,
    targetId: z.string().trim().min(1).max(36),
    targetField: syncTargetFieldSchema,
    displayId: z.string().trim().min(1).max(50),
    name: z.string().max(500),
    value: z.string().max(100_000),
    attributes: z.record(z.string(), z.unknown()).optional(),
    hierarchy: hierarchySchema,
  })
  .superRefine((target, context) => {
    if (TARGET_FIELDS[target.targetType] !== target.targetField) {
      context.addIssue({
        code: "custom",
        path: ["targetField"],
        message: `${target.targetType}에는 ${TARGET_FIELDS[target.targetType]}만 허용됩니다.`,
      });
    }
  });

export const designSnapshotSchema = z.object({
  projectId: z.string().trim().min(1).max(36),
  unitWork: z.object({
    id: z.string().trim().min(1).max(36),
    displayId: z.string().trim().regex(/^UW-\d{5}$/),
    name: z.string().max(500),
  }),
  requirements: z.array(z.record(z.string(), z.unknown())).max(100).default([]),
  userStories: z.array(z.record(z.string(), z.unknown())).max(500).default([]),
  acceptanceCriteria: z.array(z.string().max(10_000)).max(500).default([]),
  apiRefs: z.array(z.record(z.string(), z.unknown())).max(500).default([]),
  dbRefs: z.array(z.record(z.string(), z.unknown())).max(500).default([]),
  targets: z.array(designTargetSchema).min(1).max(5_000),
});
export type DesignSnapshot = z.infer<typeof designSnapshotSchema>;
