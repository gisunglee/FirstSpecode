/**
 * 스펙 정합성 공개 계약과 허용 코드.
 *
 * API·MCP·워커 커맨드가 같은 enum과 validation을 사용해야 제출 형식이
 * 경로마다 달라지지 않는다. 자동 적용 대상은 의도적으로 설명 필드 네 개로 제한한다.
 */

import { z } from "zod";
import { analysisScopeSchema } from "./batchContracts";

export const TARGET_FIELDS = {
  UNIT_WORK: "unit_work_dc",
  SCREEN: "scrn_dc",
  AREA: "area_dc",
  FUNCTION: "func_dc",
} as const;

export type ReconcileTargetType = keyof typeof TARGET_FIELDS;
export type ReconcileTargetField =
  (typeof TARGET_FIELDS)[ReconcileTargetType];

export const targetTypeSchema = z.enum([
  "UNIT_WORK",
  "SCREEN",
  "AREA",
  "FUNCTION",
]);

export const sourceEvidenceSchema = z.record(z.string(), z.unknown());

export const reconcileProposalSchema = z
  .object({
    targetRefType: targetTypeSchema,
    targetRefId: z.string().trim().min(1).max(36),
    targetField: z.enum([
      "unit_work_dc",
      "scrn_dc",
      "area_dc",
      "func_dc",
    ]),
    beforeValue: z.string().max(100_000),
    proposedValue: z.string().max(100_000),
    beforeHash: z.string().regex(/^[a-f0-9]{64}$/i),
    classification: z
      .enum([
        "CONFORMING",
        "IMPLEMENTATION_DETAIL",
        "SPEC_CLARIFICATION",
        "SPEC_CHANGE",
        "SPEC_VIOLATION",
        "TEMPORARY_EXCEPTION",
        "MODEL_GAP",
        "UNKNOWN",
      ])
      .default("SPEC_CHANGE"),
    sourceFact: z.string().trim().min(1).max(20_000),
    inferredImpact: z.string().trim().max(20_000).optional(),
    sourceEvidence: sourceEvidenceSchema.default({}),
    risk: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
    confidence: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  })
  .superRefine((proposal, context) => {
    if (TARGET_FIELDS[proposal.targetRefType] !== proposal.targetField) {
      context.addIssue({
        code: "custom",
        path: ["targetField"],
        message: `${proposal.targetRefType}에는 ${TARGET_FIELDS[proposal.targetRefType]}만 적용할 수 있습니다.`,
      });
    }
  });

export const receiptSubmissionSchema = z.object({
  clientSubmissionKey: z.string().trim().min(1).max(100).optional(),
  parentReceiptId: z.string().trim().min(1).max(36).optional(),
  repoKey: z.string().trim().min(1).max(200),
  repoProvider: z
    .enum(["GITHUB", "GITLAB", "LOCAL", "NONE", "ETC"])
    .default("LOCAL"),
  branchName: z.string().trim().min(1).max(200),
  checkpointType: z.enum(["GIT_COMMIT", "SOURCE_MANIFEST"]),
  baseCheckpoint: z.string().trim().min(7).max(128),
  headCheckpoint: z.string().trim().min(7).max(128),
  headStable: z.boolean().default(true),
  evidenceTrust: z.enum([
    "PROVIDER_VERIFIED",
    "LOCAL_AGENT_ATTESTED",
    "USER_UPLOADED",
  ]),
  evidenceVerify: z
    .enum(["PENDING", "VERIFIED", "FAILED", "OVERRIDDEN", "ATTESTED"])
    .default("PENDING"),
  ancestryVerified: z.boolean().nullable().optional(),
  diffHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  evidenceVerifyData: sourceEvidenceSchema.optional(),
  sourceEvidence: sourceEvidenceSchema,
  manifest: sourceEvidenceSchema.optional(),
  selectedTargets: z.array(
    z.object({
      targetRefType: targetTypeSchema,
      targetRefId: z.string().trim().min(1).max(36),
    }),
  ).max(500).optional(),
  analysisScope: analysisScopeSchema,
  summary: z.string().trim().max(4_000).optional(),
  analysisVersion: z.string().trim().max(50).optional(),
  prUrl: z.string().url().max(2_000).optional(),
  proposals: z.array(reconcileProposalSchema).max(500),
});

export type ReceiptSubmission = z.infer<typeof receiptSubmissionSchema>;
export type ReconcileProposal = z.infer<typeof reconcileProposalSchema>;

export function isValidCheckpoint(
  type: "GIT_COMMIT" | "SOURCE_MANIFEST",
  value: string,
  stable = true,
) {
  return type === "SOURCE_MANIFEST"
    ? /^[a-f0-9]{64}$/i.test(value)
    : stable
      ? /^[a-f0-9]{7,128}$/i.test(value)
      : /^(?:[a-f0-9]{7,128}|WORKTREE:[a-f0-9]{64})$/i.test(value);
}
