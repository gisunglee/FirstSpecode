/**
 * receipt 증거 확인 및 최종 정합성 확정.
 *
 * 후보가 0건인 receipt도 사람이 증거를 확인한 뒤 이 API로 baseline을 전진시킨다.
 * DRAFT(미커밋 포함)는 안정적인 최종 checkpoint를 제출해야 VERIFY할 수 있다.
 */

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { requirePermission } from "@/lib/requirePermission";
import {
  closeReceiptIfResolved,
  markReceiptStaleBaseline,
  StaleBaselineConflict,
} from "@/lib/spec-reconciliation/closeReceipt";
import {
  isValidCheckpoint,
  sourceEvidenceSchema,
} from "@/lib/spec-reconciliation/contracts";

type RouteParams = {
  params: Promise<{ id: string; receiptId: string }>;
};

const requestSchema = z.object({
  action: z.enum(["VERIFY", "OVERRIDE"]).default("VERIFY"),
  reason: z.string().trim().max(4_000).optional(),
  headCheckpoint: z.string().trim().min(7).max(128).optional(),
  ancestryVerified: z.boolean().nullable().optional(),
  diffHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  evidence: sourceEvidenceSchema.optional(),
}).superRefine((value, context) => {
  if (value.action === "OVERRIDE" && !value.reason) {
    context.addIssue({
      code: "custom",
      path: ["reason"],
      message: "override 사유가 필요합니다.",
    });
  }
});

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, receiptId } = await params;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }
  const parsed = requestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(
      "VALIDATION_ERROR",
      "검증 요청 형식이 올바르지 않습니다.",
      400,
      { issues: parsed.error.issues },
    );
  }
  const body = parsed.data;
  const gate = await requirePermission(
    request,
    projectId,
    body.action === "OVERRIDE"
      ? "specReconcile.override"
      : "specReconcile.review",
  );
  if (gate instanceof Response) return gate;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const receipt = await tx.tbSpImplReceipt.findFirst({
        where: {
          receipt_id: receiptId,
          prjct_id: projectId,
          receipt_sttus_code: { in: ["DRAFT", "NEEDS_REVIEW"] },
        },
        select: {
          receipt_sttus_code: true,
          review_sttus_code: true,
          checkpoint_ty_code: true,
          head_checkpoint_val: true,
          evidence_trust_code: true,
          baseline_version_no: true,
          sourceBaseline: {
            select: { checkpoint_version_no: true },
          },
        },
      });
      if (!receipt) return { kind: "NOT_FOUND" as const };
      if (
        [
          "ANALYZING",
          "ANALYSIS_FAILED",
          "ANALYSIS_PARTIAL_FAILED",
          "BATCH_CONFLICT",
        ].includes(
          receipt.review_sttus_code,
        )
      ) {
        return {
          kind: "ANALYSIS_NOT_READY" as const,
          reviewStatus: receipt.review_sttus_code,
        };
      }
      if (
        receipt.baseline_version_no !==
        receipt.sourceBaseline.checkpoint_version_no
      ) {
        return { kind: "STALE_BASELINE" as const };
      }

      const headCheckpoint =
        body.headCheckpoint ?? receipt.head_checkpoint_val;
      if (!isValidCheckpoint(receipt.checkpoint_ty_code as never, headCheckpoint)) {
        return { kind: "INVALID_CHECKPOINT" as const };
      }
      if (
        receipt.checkpoint_ty_code === "GIT_COMMIT" &&
        body.headCheckpoint &&
        body.ancestryVerified !== true
      ) {
        return { kind: "INVALID_ANCESTRY" as const };
      }
      if (
        body.action === "VERIFY" &&
        receipt.evidence_trust_code === "USER_UPLOADED"
      ) {
        return { kind: "OVERRIDE_REQUIRED" as const };
      }

      await tx.tbSpImplReceipt.update({
        where: { receipt_id: receiptId },
        data: {
          head_checkpoint_val: headCheckpoint,
          head_stable_yn: "Y",
          evidence_verify_code:
            body.action === "OVERRIDE" ? "OVERRIDDEN" : "VERIFIED",
          evidence_verify_data: body.evidence
            ? {
                verificationEvidence: body.evidence,
                verifiedBy: gate.mberId,
              } as Prisma.InputJsonValue
            : undefined,
          ancestry_verify_yn:
            body.ancestryVerified == null
              ? undefined
              : body.ancestryVerified
                ? "Y"
                : "N",
          diff_hash: body.diffHash?.toLowerCase(),
          override_rsn_cn:
            body.action === "OVERRIDE" ? body.reason! : undefined,
          override_mber_id:
            body.action === "OVERRIDE" ? gate.mberId : undefined,
          receipt_sttus_code: "NEEDS_REVIEW",
          review_sttus_code: "NEEDS_REVIEW",
          verified_dt: new Date(),
          mdfcn_dt: new Date(),
        },
      });
      const close = await closeReceiptIfResolved(tx, receiptId, gate.mberId);
      return {
        kind: "VERIFIED" as const,
        receiptClosed: close.closed,
        closeBlockedReason: close.closed ? null : close.reason,
      };
    });

    if (result.kind === "NOT_FOUND") {
      return apiError("NOT_FOUND", "검증 가능한 receipt를 찾을 수 없습니다.", 404);
    }
    if (result.kind === "STALE_BASELINE") {
      await markReceiptStaleBaseline(receiptId);
      return apiError("STALE_BASELINE", "baseline이 이미 전진했습니다.", 409);
    }
    if (result.kind === "ANALYSIS_NOT_READY") {
      return apiError(
        "ANALYSIS_NOT_READY",
        result.reviewStatus === "ANALYZING"
          ? "AI 정합성 분석이 진행 중입니다."
          : result.reviewStatus === "BATCH_CONFLICT"
            ? "배치별 제안 충돌을 먼저 해결해 주세요."
            : "AI 분석 배치가 실패했습니다. 실패한 배치를 다시 요청해 주세요.",
        409,
      );
    }
    if (result.kind === "INVALID_CHECKPOINT") {
      return apiError("INVALID_CHECKPOINT", "최종 checkpoint 형식이 올바르지 않습니다.", 400);
    }
    if (result.kind === "INVALID_ANCESTRY") {
      return apiError("INVALID_ANCESTRY", "Git ancestry 검증이 필요합니다.", 409);
    }
    if (result.kind === "OVERRIDE_REQUIRED") {
      return apiError(
        "OVERRIDE_REQUIRED",
        "사용자 업로드 증거는 OWNER/ADMIN override가 필요합니다.",
        409,
      );
    }
    return apiSuccess(result);
  } catch (error) {
    if (error instanceof StaleBaselineConflict) {
      await markReceiptStaleBaseline(error.receiptId);
      return apiError(
        "STALE_BASELINE",
        "baseline 충돌로 검증을 되돌렸습니다.",
        409,
      );
    }
    console.error(
      `[POST /api/projects/${projectId}/spec-reconciliations/${receiptId}/verify] 오류:`,
      error,
    );
    return apiError("DB_ERROR", "receipt를 검증하지 못했습니다.", 500);
  }
}
