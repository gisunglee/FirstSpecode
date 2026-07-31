/**
 * POST .../items/[itemId]/no-spec-change — 스펙 영향 없음 결정 (FID-00214)
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { requirePermission } from "@/lib/requirePermission";
import {
  closeReceiptIfResolved,
  markReceiptStaleBaseline,
  StaleBaselineConflict,
} from "@/lib/spec-reconciliation/closeReceipt";
import { upsertConfirmedSourceLinks } from "@/lib/spec-reconciliation/sourceLinks";
import type { ReconcileTargetType } from "@/lib/spec-reconciliation/contracts";

type RouteParams = {
  params: Promise<{ id: string; receiptId: string; itemId: string }>;
};

const requestSchema = z.object({
  reason: z.string().trim().min(1).max(4_000),
});

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, receiptId, itemId } = await params;
  const gate = await requirePermission(request, projectId, "specReconcile.apply");
  if (gate instanceof Response) return gate;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }
  const parsed = requestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", "스펙 영향 없음 사유를 입력해 주세요.", 400);
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.tbSpReconcileItem.findFirst({
        where: {
          item_id:         itemId,
          receipt_id:      receiptId,
          item_sttus_code: "PENDING",
          receipt: {
            prjct_id:           projectId,
            receipt_sttus_code: "NEEDS_REVIEW",
            review_sttus_code:  "NEEDS_REVIEW",
          },
        },
        select: {
          item_id: true,
          target_ref_ty_code: true,
          target_ref_id: true,
          source_evidence_data: true,
          receipt: {
            select: {
              baseline_version_no: true,
              sourceBaseline: {
                select: { checkpoint_version_no: true },
              },
            },
          },
        },
      });
      if (!item) return { kind: "NOT_FOUND" as const };

      if (
        item.receipt.sourceBaseline.checkpoint_version_no !==
        item.receipt.baseline_version_no
      ) {
        await tx.tbSpImplReceipt.update({
          where: { receipt_id: receiptId },
          data: {
            receipt_sttus_code: "STALE_BASELINE",
            mdfcn_dt:           new Date(),
          },
        });
        return { kind: "STALE_BASELINE" as const };
      }

      await tx.tbSpReconcileItem.update({
        where: { item_id: item.item_id },
        data: {
          item_sttus_code:  "NO_SPEC_CHANGE",
          decision_code:    "NO_SPEC_CHANGE",
          decision_rsn_cn:  parsed.data.reason,
          decision_mber_id: gate.mberId,
          decision_dt:      new Date(),
          resolved_dt:      new Date(),
          mdfcn_dt:         new Date(),
        },
      });
      await upsertConfirmedSourceLinks(tx, {
        projectId,
        receiptId,
        targetType: item.target_ref_ty_code as ReconcileTargetType,
        targetId: item.target_ref_id,
        evidence: item.source_evidence_data,
      });

      const close = await closeReceiptIfResolved(tx, receiptId, gate.mberId);
      return {
        kind: "RESOLVED" as const,
        receiptClosed: close.closed,
      };
    });

    if (result.kind === "NOT_FOUND") {
      return apiError("NOT_FOUND", "결정 가능한 스펙 변경 항목을 찾을 수 없습니다.", 404);
    }
    if (result.kind === "STALE_BASELINE") {
      return apiError(
        "STALE_BASELINE",
        "다른 접수가 source baseline을 먼저 갱신했습니다. 최신 기준으로 다시 분석해 주세요.",
        409,
      );
    }

    return apiSuccess({
      itemId,
      status: "NO_SPEC_CHANGE",
      receiptClosed: result.receiptClosed,
    });
  } catch (error) {
    if (error instanceof StaleBaselineConflict) {
      await markReceiptStaleBaseline(error.receiptId);
      return apiError(
        "STALE_BASELINE",
        "다른 접수가 source baseline을 먼저 갱신했습니다. 결정을 저장하지 않았습니다.",
        409,
      );
    }
    console.error(
      `[POST /api/projects/${projectId}/spec-reconciliations/${receiptId}/items/${itemId}/no-spec-change] 오류:`,
      error,
    );
    return apiError("DB_ERROR", "스펙 영향 없음 결정을 저장하지 못했습니다.", 500);
  }
}
