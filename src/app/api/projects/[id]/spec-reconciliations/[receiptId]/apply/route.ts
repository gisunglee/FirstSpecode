/**
 * 낮은 위험도의 안전한 후보를 한 트랜잭션으로 일괄 적용한다.
 *
 * 하나라도 충돌·대상 누락·3-way 검토가 필요하면 전체를 rollback한다.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { requirePermission } from "@/lib/requirePermission";
import {
  applySpecItem,
  type ApplySpecItemResult,
} from "@/lib/spec-reconciliation/applySpecItem";
import {
  markReceiptStaleBaseline,
  StaleBaselineConflict,
} from "@/lib/spec-reconciliation/closeReceipt";

type RouteParams = {
  params: Promise<{ id: string; receiptId: string }>;
};

const requestSchema = z.object({
  itemIds: z.array(z.string().trim().min(1).max(36)).min(1).max(100),
  reason: z.string().trim().max(4_000).optional(),
});

class BulkApplyAbort extends Error {
  constructor(
    readonly itemId: string,
    readonly result: ApplySpecItemResult,
  ) {
    super(`일괄 적용 중단: ${itemId} ${result.kind}`);
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, receiptId } = await params;
  const gate = await requirePermission(
    request,
    projectId,
    "specReconcile.apply",
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
    return apiError("VALIDATION_ERROR", "일괄 적용 항목이 올바르지 않습니다.", 400);
  }
  const itemIds = [...new Set(parsed.data.itemIds)];

  try {
    const result = await prisma.$transaction(async (tx) => {
      const candidates = await tx.tbSpReconcileItem.findMany({
        where: {
          receipt_id: receiptId,
          item_id: { in: itemIds },
          receipt: { prjct_id: projectId },
        },
        select: {
          item_id: true,
          risk_code: true,
          classification_code: true,
        },
      });
      if (candidates.length !== itemIds.length) {
        return { kind: "NOT_FOUND" as const };
      }
      const unsafe = candidates.find(
        (item) =>
          !["LOW", "MEDIUM"].includes(item.risk_code) ||
          !["IMPLEMENTATION_DETAIL", "SPEC_CLARIFICATION"].includes(
            item.classification_code,
          ),
      );
      if (unsafe) {
        return { kind: "INDIVIDUAL_REVIEW_REQUIRED" as const, itemId: unsafe.item_id };
      }

      const applied = [];
      for (const itemId of itemIds) {
        const itemResult = await applySpecItem(tx, {
          projectId,
          receiptId,
          itemId,
          memberId: gate.mberId,
          decisionReason: parsed.data.reason,
        });
        if (itemResult.kind !== "APPLIED") {
          throw new BulkApplyAbort(itemId, itemResult);
        }
        applied.push({
          itemId,
          designChangeId: itemResult.designChangeId,
        });
      }
      return { kind: "APPLIED" as const, items: applied };
    });

    if (result.kind === "NOT_FOUND") {
      return apiError("NOT_FOUND", "일괄 적용 항목 일부를 찾을 수 없습니다.", 404);
    }
    if (result.kind === "INDIVIDUAL_REVIEW_REQUIRED") {
      return apiError(
        "INDIVIDUAL_REVIEW_REQUIRED",
        "중요하거나 분류가 불명확한 항목은 개별 검토해야 합니다.",
        409,
        { itemId: result.itemId },
      );
    }
    return apiSuccess(result);
  } catch (error) {
    if (error instanceof StaleBaselineConflict) {
      await markReceiptStaleBaseline(error.receiptId);
      return apiError(
        "STALE_BASELINE",
        "baseline 충돌로 일괄 적용 전체를 되돌렸습니다.",
        409,
      );
    }
    if (error instanceof BulkApplyAbort) {
      return apiError(
        error.result.kind,
        "한 항목이 개별 검토를 요구해 일괄 적용 전체를 되돌렸습니다.",
        409,
        { itemId: error.itemId, result: error.result },
      );
    }
    console.error(
      `[POST /api/projects/${projectId}/spec-reconciliations/${receiptId}/apply] 오류:`,
      error,
    );
    return apiError("DB_ERROR", "일괄 적용에 실패했습니다.", 500);
  }
}

