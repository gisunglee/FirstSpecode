/** 웹 검토자가 문제 항목에 내리는 적용·거부·보류 결정 계약. */

import { z } from "zod";

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
