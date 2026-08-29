/** 로컬 소스 탐색 범위와 검증 가능한 코드 근거 계약. */

import { z } from "zod";

const sourceScopeFileBaseSchema = z.object({
  path: z.string().trim().min(1).max(1_000),
  symbols: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  kind: z.enum(["PRIMARY", "SUPPORTING", "TEST"]),
  reason: z.string().trim().min(1).max(2_000),
});

// 분석을 시작할 때 고정한 파일 원문 hash다. 제출 직전 로컬 helper가 다시 계산해
// 중간에 바뀐 소스를 과거 판단과 섞어 제출하지 못하게 한다.
export const sourceScopeFileSchema = sourceScopeFileBaseSchema.extend({
  contentHash: z.string().regex(/^[a-f0-9]{64}$/i),
});

export const confirmedSourceScopeSchema = z
  .object({
    status: z.literal("CONFIRMED"),
    files: z.array(sourceScopeFileSchema).min(1).max(1_000),
    userConfirmed: z.boolean(),
    confirmationNote: z.string().max(4_000).nullable().default(null),
  })
  .superRefine((scope, context) => {
    if (scope.userConfirmed && !scope.confirmationNote?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["confirmationNote"],
        message: "사용자 확인 범위에는 확인 내용을 기록해야 합니다.",
      });
    }
  });

export const needsInputSourceScopeSchema = z.object({
  status: z.literal("NEEDS_INPUT"),
  // 질문 단계에서는 아직 범위가 확정되지 않았으므로 hash를 요구하지 않는다.
  files: z.array(sourceScopeFileBaseSchema).max(1_000).default([]),
  questions: z.array(z.string().trim().min(1).max(2_000)).min(1).max(10),
});

export const evidenceSchema = z
  .object({
    path: z.string().trim().min(1).max(1_000),
    symbol: z.string().trim().max(500).nullable().default(null),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    snippet: z.string().min(1).max(8_000),
    snippetHash: z.string().regex(/^[a-f0-9]{64}$/i),
    redacted: z.boolean().default(false),
  })
  .refine((evidence) => evidence.endLine >= evidence.startLine, {
    path: ["endLine"],
    message: "endLine은 startLine보다 작을 수 없습니다.",
  });
