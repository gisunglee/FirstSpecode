/**
 * FIX_SOURCE 후 보완 소스 증거를 확인하고 항목을 해결한다.
 *
 * 원 receipt의 base는 유지하고 head만 최종 수정 checkpoint로 갱신한다. 이렇게 해야
 * baseline에서 최종 소스까지의 전체 범위를 하나의 정합성 확정점으로 닫을 수 있다.
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
  type ReconcileTargetType,
} from "@/lib/spec-reconciliation/contracts";
import { upsertConfirmedSourceLinks } from "@/lib/spec-reconciliation/sourceLinks";

type RouteParams = {
  params: Promise<{ id: string; receiptId: string; itemId: string }>;
};

const requestSchema = z.object({
  checkpointType: z.enum(["GIT_COMMIT", "SOURCE_MANIFEST"]),
  headCheckpoint: z.string().trim().min(7).max(128),
  evidenceTrust: z.enum(["LOCAL_AGENT_ATTESTED", "USER_UPLOADED"]),
  ancestryVerified: z.boolean().nullable().optional(),
  diffHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  evidence: sourceEvidenceSchema,
  sourceFact: z.string().trim().min(1).max(20_000),
  reason: z.string().trim().min(1).max(4_000),
});

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, receiptId, itemId } = await params;
  const gate = await requirePermission(
    request,
    projectId,
    "specReconcile.review",
  );
  if (gate instanceof Response) return gate;

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
      "보완 증거 형식이 올바르지 않습니다.",
      400,
      { issues: parsed.error.issues },
    );
  }
  const body = parsed.data;
  if (!isValidCheckpoint(body.checkpointType, body.headCheckpoint)) {
    return apiError("VALIDATION_ERROR", "head checkpoint 형식이 올바르지 않습니다.", 400);
  }
  if (body.checkpointType === "GIT_COMMIT" && body.ancestryVerified !== true) {
    return apiError(
      "INVALID_ANCESTRY",
      "Git 보완 증거는 base→head ancestry 검증이 필요합니다.",
      409,
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.tbSpReconcileItem.findFirst({
        where: {
          item_id: itemId,
          receipt_id: receiptId,
          item_sttus_code: "AWAITING_SOURCE_FIX",
          decision_code: "FIX_SOURCE",
          receipt: {
            prjct_id: projectId,
            receipt_sttus_code: "NEEDS_REVIEW",
            review_sttus_code: "NEEDS_REVIEW",
          },
        },
        select: {
          target_ref_ty_code: true,
          target_ref_id: true,
          source_evidence_data: true,
          receipt: {
            select: {
              checkpoint_ty_code: true,
              baseline_version_no: true,
              sourceBaseline: {
                select: { checkpoint_version_no: true },
              },
            },
          },
        },
      });
      if (!item) return { kind: "NOT_FOUND" as const };
      if (item.receipt.checkpoint_ty_code !== body.checkpointType) {
        return { kind: "CHECKPOINT_TYPE_MISMATCH" as const };
      }
      if (
        item.receipt.baseline_version_no !==
        item.receipt.sourceBaseline.checkpoint_version_no
      ) {
        return { kind: "STALE_BASELINE" as const };
      }

      await tx.tbSpImplReceipt.update({
        where: { receipt_id: receiptId },
        data: {
          head_checkpoint_val: body.headCheckpoint,
          head_stable_yn: "Y",
          evidence_trust_code: body.evidenceTrust,
          evidence_verify_code:
            body.evidenceTrust === "LOCAL_AGENT_ATTESTED" ? "ATTESTED" : "PENDING",
          ancestry_verify_yn:
            body.ancestryVerified == null
              ? null
              : body.ancestryVerified
                ? "Y"
                : "N",
          diff_hash: body.diffHash?.toLowerCase() ?? null,
          evidence_verify_data: {
            resolutionEvidence: body.evidence,
            resolvedItemId: itemId,
            confirmedBy: gate.mberId,
          } as Prisma.InputJsonValue,
          mdfcn_dt: new Date(),
        },
      });
      await tx.tbSpReconcileItem.update({
        where: { item_id: itemId },
        data: {
          item_sttus_code: "RESOLVED",
          decision_rsn_cn: body.reason,
          resolution_evidence_data: {
            sourceFact: body.sourceFact,
            evidence: body.evidence,
            headCheckpoint: body.headCheckpoint,
            evidenceTrust: body.evidenceTrust,
          } as Prisma.InputJsonValue,
          resolved_dt: new Date(),
          mdfcn_dt: new Date(),
        },
      });
      await upsertConfirmedSourceLinks(tx, {
        projectId,
        receiptId,
        targetType: item.target_ref_ty_code as ReconcileTargetType,
        targetId: item.target_ref_id,
        evidence: body.evidence,
      });
      const close = await closeReceiptIfResolved(tx, receiptId, gate.mberId);
      return {
        kind: "RESOLVED" as const,
        receiptClosed: close.closed,
        closeBlockedReason: close.closed ? null : close.reason,
      };
    });

    if (result.kind === "NOT_FOUND") {
      return apiError("NOT_FOUND", "소스 수정 대기 항목을 찾을 수 없습니다.", 404);
    }
    if (result.kind === "CHECKPOINT_TYPE_MISMATCH") {
      return apiError(
        "CHECKPOINT_TYPE_MISMATCH",
        "기존 receipt와 같은 checkpointType으로 제출해야 합니다.",
        400,
      );
    }
    if (result.kind === "STALE_BASELINE") {
      await markReceiptStaleBaseline(receiptId);
      return apiError("STALE_BASELINE", "baseline이 이미 전진했습니다.", 409);
    }
    return apiSuccess(result);
  } catch (error) {
    if (error instanceof StaleBaselineConflict) {
      await markReceiptStaleBaseline(error.receiptId);
      return apiError(
        "STALE_BASELINE",
        "baseline 충돌로 보완 확인을 되돌렸습니다.",
        409,
      );
    }
    console.error(
      `[POST /api/projects/${projectId}/spec-reconciliations/${receiptId}/items/${itemId}/confirm-resolution] 오류:`,
      error,
    );
    return apiError("DB_ERROR", "보완 증거를 저장하지 못했습니다.", 500);
  }
}
