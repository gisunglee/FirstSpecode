/** POST — 실패한 router/분석 배치만 새 AI task로 재시도한다. */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { requirePermission } from "@/lib/requirePermission";
import {
  BatchPlanningError,
  retryReconciliationBatch,
} from "@/lib/spec-reconciliation/batchPlanner";

type RouteParams = {
  params: Promise<{ id: string; receiptId: string; batchId: string }>;
};

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, receiptId, batchId } = await params;
  const gate = await requirePermission(
    request,
    projectId,
    "specReconcile.review",
  );
  if (gate instanceof Response) return gate;
  try {
    const owned = await prisma.tbSpReconcileBatch.findFirst({
      where: { batch_id: batchId, receipt_id: receiptId, prjct_id: projectId },
      select: { batch_id: true },
    });
    if (!owned) {
      return apiError("NOT_FOUND", "재시도할 배치를 찾을 수 없습니다.", 404);
    }
    const result = await prisma.$transaction((tx) =>
      retryReconciliationBatch(tx, batchId, gate.mberId),
    );
    return apiSuccess(result, 202);
  } catch (error) {
    if (error instanceof BatchPlanningError) {
      return apiError(error.code, error.message, error.status);
    }
    console.error(`[POST retry reconcile batch ${batchId}] 오류:`, error);
    return apiError("DB_ERROR", "배치 재시도에 실패했습니다.", 500);
  }
}
