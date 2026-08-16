/**
 * 구현-설계 동기화 V2의 공개 계약.
 *
 * CHECK와 DEEP_SYNC의 결과 방향을 분리하고, AI가 설계의 AS-IS 값을
 * 결정하지 못하도록 proposal에는 TO-BE만 허용한다.
 */

import { z } from "zod";
import {
  TARGET_FIELDS,
  syncTargetFieldSchema,
  syncTargetTypeSchema,
} from "./designContracts";
import {
  confirmedSourceScopeSchema,
  evidenceSchema,
  needsInputSourceScopeSchema,
} from "./sourceContracts";
export {
  TARGET_FIELDS,
  designSnapshotSchema,
  designTargetSchema,
  syncTargetFieldSchema,
  syncTargetTypeSchema,
} from "./designContracts";
export type {
  DesignSnapshot,
  SyncTargetField,
  SyncTargetType,
} from "./designContracts";
export {
  confirmedSourceScopeSchema,
  evidenceSchema,
  needsInputSourceScopeSchema,
  sourceScopeFileSchema,
} from "./sourceContracts";

export const SYNC_MODES = ["CHECK", "DEEP_SYNC"] as const;
export const syncModeSchema = z.enum(SYNC_MODES);
export type SyncMode = z.infer<typeof syncModeSchema>;

export const confidenceSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export const importanceSchema = z.enum([
  "CRITICAL",
  "HIGH",
  "NORMAL",
  "DETAIL",
]);

export const proposalSchema = z
  .object({
    targetType: syncTargetTypeSchema,
    targetId: z.string().trim().min(1).max(36),
    targetField: syncTargetFieldSchema,
    proposedValue: z.string().max(100_000).refine((value) => value.trim().length > 0, {
      message: "제안 설계는 비어 있을 수 없습니다.",
    }),
  })
  .superRefine((proposal, context) => {
    if (TARGET_FIELDS[proposal.targetType] !== proposal.targetField) {
      context.addIssue({
        code: "custom",
        path: ["targetField"],
        message: `${proposal.targetType}에는 ${TARGET_FIELDS[proposal.targetType]}만 허용됩니다.`,
      });
    }
  });

export const implementationFindingSchema = z
  .object({
    targetType: syncTargetTypeSchema,
    targetId: z.string().trim().min(1).max(36),
    targetField: syncTargetFieldSchema,
    resultCode: z.enum([
      "MATCH",
      "MISMATCH",
      "NOT_IMPLEMENTED",
      "UNKNOWN",
    ]),
    designStatement: z.string().max(20_000),
    sourceFact: z.string().max(20_000).nullable().default(null),
    reason: z.string().trim().min(1).max(20_000),
    evidence: z.array(evidenceSchema).max(20).default([]),
    confidence: confidenceSchema,
    proposal: proposalSchema.nullable().default(null),
  })
  .superRefine((finding, context) => {
    if (TARGET_FIELDS[finding.targetType] !== finding.targetField) {
      context.addIssue({
        code: "custom",
        path: ["targetField"],
        message: "대상 유형과 필드가 일치하지 않습니다.",
      });
    }
    if (
      ["MATCH", "MISMATCH"].includes(finding.resultCode) &&
      finding.evidence.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "MATCH와 MISMATCH에는 코드 근거가 필요합니다.",
      });
    }
    if (finding.resultCode !== "MISMATCH" && finding.proposal) {
      context.addIssue({
        code: "custom",
        path: ["proposal"],
        message: "구현 정합성 수정안은 확인된 MISMATCH에만 만들 수 있습니다.",
      });
    }
  });

export const designCoverageFindingSchema = z
  .object({
    resultCode: z.enum([
      "IMPORTANT_GAP_CANDIDATE",
      "GAP_CANDIDATE",
      "STRUCTURE_GAP",
      "IMPLEMENTATION_DETAIL",
      "OUT_OF_SCOPE",
      "UNKNOWN",
    ]),
    importance: importanceSchema,
    targetType: syncTargetTypeSchema.nullable().default(null),
    targetId: z.string().trim().min(1).max(36).nullable().default(null),
    targetField: syncTargetFieldSchema.nullable().default(null),
    designStatement: z.string().max(20_000).nullable().default(null),
    sourceFact: z.string().trim().min(1).max(20_000),
    reason: z.string().trim().min(1).max(20_000),
    evidence: z.array(evidenceSchema).max(20).default([]),
    confidence: confidenceSchema,
    proposal: proposalSchema.nullable().default(null),
  })
  .superRefine((finding, context) => {
    const targetParts = [
      finding.targetType,
      finding.targetId,
      finding.targetField,
    ];
    const hasSomeTarget = targetParts.some((value) => value !== null);
    const hasAllTarget = targetParts.every((value) => value !== null);
    if (hasSomeTarget && !hasAllTarget) {
      context.addIssue({
        code: "custom",
        path: ["targetId"],
        message: "대상 유형·ID·필드는 모두 있거나 모두 없어야 합니다.",
      });
    }
    if (finding.resultCode !== "UNKNOWN" && finding.evidence.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "확인된 설계 커버리지 판정에는 코드 근거가 필요합니다.",
      });
    }
    if (
      !["IMPORTANT_GAP_CANDIDATE", "GAP_CANDIDATE"].includes(
        finding.resultCode,
      ) &&
      finding.proposal
    ) {
      context.addIssue({
        code: "custom",
        path: ["proposal"],
        message: `${finding.resultCode}에는 설명 필드 수정안을 만들 수 없습니다.`,
      });
    }
  });

export const syncAnalysisPayloadSchema = z
  .object({
    mode: syncModeSchema,
    sourceScope: confirmedSourceScopeSchema,
    implementation: z.object({
      verdict: z.enum(["PASS", "FAIL", "UNKNOWN"]),
      summary: z.string().max(10_000),
      items: z.array(implementationFindingSchema).max(5_000),
    }),
    designCoverage: z.object({
      verdict: z.enum(["CLEAR", "GAP_CANDIDATE", "UNKNOWN"]),
      summary: z.string().max(10_000),
      items: z.array(designCoverageFindingSchema).max(5_000),
    }),
  })
  .superRefine((result, context) => {
    if (
      result.mode === "CHECK" &&
      result.designCoverage.items.some(
        (item) => item.resultCode === "GAP_CANDIDATE",
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["designCoverage", "items"],
        message: "CHECK는 일반 GAP_CANDIDATE를 반환하지 않습니다.",
      });
    }

    const hasImplementationFailure = result.implementation.items.some((item) =>
      ["MISMATCH", "NOT_IMPLEMENTED"].includes(item.resultCode),
    );
    const hasImplementationUnknown = result.implementation.items.some(
      (item) => item.resultCode === "UNKNOWN",
    );
    const expectedImplementationVerdict = hasImplementationFailure
      ? "FAIL"
      : hasImplementationUnknown
        ? "UNKNOWN"
        : "PASS";
    if (result.implementation.verdict !== expectedImplementationVerdict) {
      context.addIssue({
        code: "custom",
        path: ["implementation", "verdict"],
        message: `항목 결과상 구현 verdict는 ${expectedImplementationVerdict}이어야 합니다.`,
      });
    }

    const hasCoverageGap = result.designCoverage.items.some((item) =>
      [
        "IMPORTANT_GAP_CANDIDATE",
        "GAP_CANDIDATE",
        "STRUCTURE_GAP",
      ].includes(item.resultCode),
    );
    const hasCoverageUnknown = result.designCoverage.items.some(
      (item) => item.resultCode === "UNKNOWN",
    );
    const expectedCoverageVerdict = hasCoverageGap
      ? "GAP_CANDIDATE"
      : hasCoverageUnknown
        ? "UNKNOWN"
        : "CLEAR";
    if (result.designCoverage.verdict !== expectedCoverageVerdict) {
      context.addIssue({
        code: "custom",
        path: ["designCoverage", "verdict"],
        message: `항목 결과상 설계 커버리지 verdict는 ${expectedCoverageVerdict}이어야 합니다.`,
      });
    }
  });
export type SyncAnalysisPayload = z.infer<typeof syncAnalysisPayloadSchema>;

export const syncResultSubmissionSchema = z.discriminatedUnion("resultStatus", [
  z.object({
    resultStatus: z.literal("ANALYZED"),
    analysis: syncAnalysisPayloadSchema,
  }),
  z.object({
    resultStatus: z.literal("NEEDS_INPUT"),
    sourceScope: needsInputSourceScopeSchema,
  }),
  z.object({
    resultStatus: z.literal("FAILED"),
    errorMessage: z.string().trim().min(1).max(10_000),
  }),
]);

export const syncDecisionSchema = z
  .object({
    decision: z.enum(["APPLY", "REJECT", "DEFER"]),
    reason: z.string().trim().max(4_000).default(""),
  })
  .superRefine((decision, context) => {
    if (decision.decision !== "APPLY" && !decision.reason) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "거부와 보류에는 사유가 필요합니다.",
      });
    }
  });
