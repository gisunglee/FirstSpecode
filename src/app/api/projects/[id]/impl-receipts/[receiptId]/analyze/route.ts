/**
 * 저장된 receipt를 자동 비교 배치로 계획하고 AI Worker 큐에 넣는다.
 *
 * 작은 범위는 분석 배치 하나, 큰 범위는 가벼운 router → 화면/영역별 분석 배치로
 * 분리한다. 모든 결과는 다시 같은 receipt로 병합된다.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { requirePermission } from "@/lib/requirePermission";
import { BATCH_LIMITS } from "@/lib/spec-reconciliation/batchContracts";
import {
  BatchPlanningError,
  queueReconciliationBatchAnalysis,
} from "@/lib/spec-reconciliation/batchPlanner";

type RouteParams = {
  params: Promise<{ id: string; receiptId: string }>;
};

const requestSchema = z.object({
  unitWorkRef: z.string().trim().min(1).max(36).optional(),
  changedPaths: z.array(z.string().trim().min(1).max(1_000))
    .max(BATCH_LIMITS.maxChangedPaths)
    .default([]),
  includeProjectIndex: z.boolean().default(false),
  instruction: z.string().trim().max(4_000).optional(),
  replaceExisting: z.boolean().default(false),
});

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, receiptId } = await params;
  const gate = await requirePermission(
    request,
    projectId,
    "specReconcile.submit",
  );
  if (gate instanceof Response) return gate;

  let rawBody: unknown = {};
  try {
    const text = await request.text();
    rawBody = text ? JSON.parse(text) : {};
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }
  const parsed = requestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", "분석 범위가 올바르지 않습니다.", 400, {
      issues: parsed.error.issues,
    });
  }

  try {
    const result = await queueReconciliationBatchAnalysis({
      receiptId,
      projectId,
      memberId: gate.mberId,
      scope: {
        unitWorkRef: parsed.data.unitWorkRef,
        changedPaths: parsed.data.changedPaths,
        includeProjectIndex: parsed.data.includeProjectIndex,
        instruction: parsed.data.instruction,
        autoBatch: true,
      },
      replaceExisting: parsed.data.replaceExisting,
    });
    return apiSuccess(result, result.idempotent ? 200 : 202);
  } catch (error) {
    if (error instanceof BatchPlanningError) {
      return apiError(error.code, error.message, error.status);
    }
    console.error(`[POST receipt ${receiptId} batch analyze] 오류:`, error);
    return apiError("DB_ERROR", "자동 비교 배치 생성에 실패했습니다.", 500);
  }
}
