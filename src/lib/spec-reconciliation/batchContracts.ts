/**
 * 자동 비교 배치의 공개 계약과 기본 품질 예산.
 *
 * 기존 200/500/200,000 제한은 서버 보호용 상한이다. 아래 값은 한 번의 LLM 호출이
 * 집중력을 유지하도록 더 작게 잡은 품질 예산이며, 초과분은 버리지 않고 다음 배치로 넘긴다.
 */

import { z } from "zod";

export const BATCH_LIMITS = {
  maxFiles: 30,
  maxFilePatchChars: 60_000,
  maxTargets: 100,
  maxDiffChars: 80_000,
  maxContextChars: 120_000,
  maxChangedPaths: 5_000,
  maxScopesPerFile: 20,
} as const;

export const analysisScopeSchema = z.object({
  unitWorkRef: z.string().trim().min(1).max(36).optional(),
  changedPaths: z
    .array(z.string().trim().min(1).max(1_000))
    .max(BATCH_LIMITS.maxChangedPaths)
    .optional(),
  includeProjectIndex: z.boolean().default(false),
  instruction: z.string().trim().max(4_000).optional(),
  autoBatch: z.boolean().default(true),
}).optional();

export const routerResultSchema = z.object({
  assignments: z.array(z.object({
    path: z.string().trim().min(1).max(1_000),
    scopeKeys: z.array(z.string().trim().min(1).max(200))
      .max(BATCH_LIMITS.maxScopesPerFile),
    shared: z.boolean().default(false),
    confidence: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
    reason: z.string().trim().max(2_000).default(""),
  })).max(BATCH_LIMITS.maxChangedPaths),
});

export type AnalysisScope = z.infer<NonNullable<typeof analysisScopeSchema>>;
export type RouterResult = z.infer<typeof routerResultSchema>;

export type BatchTargetRef = {
  targetRefType: "UNIT_WORK" | "SCREEN" | "AREA" | "FUNCTION";
  targetRefId: string;
  targetField: "unit_work_dc" | "scrn_dc" | "area_dc" | "func_dc";
  displayId: string;
  name: string;
  description: string;
  descriptionHash: string;
  hierarchy: Record<string, unknown>;
};

export type BatchScope = {
  key: string;
  type: "UNIT_WORK" | "SCREEN" | "AREA" | "SHARED" | "UNMAPPED";
  refId: string | null;
  name: string;
  targetRefs: BatchTargetRef[];
  contextChars: number;
};

export type EvidenceFile = {
  path: string;
  symbols: string[];
  patch: string;
  raw: Record<string, unknown>;
  partNo?: number;
  partCount?: number;
};

export type FileAssignment = {
  path: string;
  scopeKeys: string[];
  shared: boolean;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  reason: string;
};
