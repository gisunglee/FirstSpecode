/** POST — 여러 배치가 같은 스펙에 다른 값을 제안한 충돌에서 하나를 선택한다. */

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { requirePermission } from "@/lib/requirePermission";
import {
  resolveBatchConflict,
} from "@/lib/spec-reconciliation/batchResults";
import { BatchPlanningError } from "@/lib/spec-reconciliation/batchPlanner";

type RouteParams = {
  params: Promise<{ id: string; receiptId: string; itemId: string }>;
};

const requestSchema = z.object({
  batchId: z.string().uuid(),
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
    return apiError("VALIDATION_ERROR", "선택할 배치가 올바르지 않습니다.", 400);
  }
  try {
    const receipt = await prisma.tbSpImplReceipt.findFirst({
      where: {
        receipt_id: receiptId,
        prjct_id: projectId,
        receipt_sttus_code: "NEEDS_REVIEW",
        review_sttus_code: "BATCH_CONFLICT",
      },
      select: { receipt_id: true },
    });
    if (!receipt) {
      return apiError("NOT_FOUND", "검토 가능한 receipt를 찾을 수 없습니다.", 404);
    }
    const result = await prisma.$transaction((tx) =>
      resolveBatchConflict(tx, {
        receiptId,
        itemId,
        batchId: parsed.data.batchId,
      }),
    );
    return apiSuccess(result);
  } catch (error) {
    if (error instanceof BatchPlanningError) {
      return apiError(error.code, error.message, error.status);
    }
    console.error(`[POST resolve batch conflict ${itemId}] 오류:`, error);
    return apiError("DB_ERROR", "배치 충돌 해결에 실패했습니다.", 500);
  }
}
