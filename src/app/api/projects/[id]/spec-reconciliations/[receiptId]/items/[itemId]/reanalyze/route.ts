/**
 * STALE_SPEC 항목을 최신 스펙 기준으로 다시 제안한다.
 *
 * AI/사용자가 새 proposedValue를 계산해 보내면 서버가 현재 스펙을 직접 읽어
 * beforeValue/hash를 교체한다. 과거 제안은 resolution_evidence_data에 감사 이력으로 남긴다.
 */

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { hashOf } from "@/lib/impl-request/diff/normalizer";
import { requirePermission } from "@/lib/requirePermission";
import type {
  ReconcileTargetField,
  ReconcileTargetType,
} from "@/lib/spec-reconciliation/contracts";
import { getTargetSnapshot } from "@/lib/spec-reconciliation/targetRegistry";

type RouteParams = {
  params: Promise<{ id: string; receiptId: string; itemId: string }>;
};

const requestSchema = z.object({
  proposedValue: z.string().max(100_000),
  sourceFact: z.string().trim().min(1).max(20_000),
  inferredImpact: z.string().trim().max(20_000).optional(),
  risk: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
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
      "재분석 제안 형식이 올바르지 않습니다.",
      400,
      { issues: parsed.error.issues },
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const item = await tx.tbSpReconcileItem.findFirst({
      where: {
        item_id: itemId,
        receipt_id: receiptId,
        item_sttus_code: "STALE_SPEC",
        receipt: {
          prjct_id: projectId,
          receipt_sttus_code: "NEEDS_REVIEW",
          review_sttus_code: "NEEDS_REVIEW",
        },
      },
    });
    if (!item) return { kind: "NOT_FOUND" as const };

    const target = await getTargetSnapshot(
      tx,
      projectId,
      item.target_ref_ty_code as ReconcileTargetType,
      item.target_ref_id,
      item.target_field_nm as ReconcileTargetField,
    );
    if (!target) return { kind: "TARGET_NOT_FOUND" as const };
    const currentHash = hashOf(target.value).hash;
    if (hashOf(parsed.data.proposedValue).hash === currentHash) {
      return { kind: "NO_DIFFERENCE" as const };
    }

    const previousAudit = {
      beforeValue: item.before_value_cn,
      proposedValue: item.proposed_value_cn,
      beforeHash: item.before_hash.trim(),
      conflict: item.merge_conflict_data,
      reanalyzedAt: new Date().toISOString(),
      reanalyzedBy: gate.mberId,
    };
    await tx.tbSpReconcileItem.update({
      where: { item_id: itemId },
      data: {
        source_fact_cn: parsed.data.sourceFact,
        inferred_impact_cn: parsed.data.inferredImpact ?? null,
        before_value_cn: target.value,
        proposed_value_cn: parsed.data.proposedValue,
        before_hash: currentHash,
        risk_code: parsed.data.risk,
        confidence_code: parsed.data.confidence,
        item_sttus_code: "PENDING",
        decision_code: null,
        decision_rsn_cn: null,
        decision_mber_id: null,
        decision_dt: null,
        merge_preview_cn: null,
        merge_latest_hash: null,
        merge_conflict_data: Prisma.JsonNull,
        resolution_evidence_data: {
          previousProposal: previousAudit,
        },
        mdfcn_dt: new Date(),
      },
    });
    return { kind: "REANALYZED" as const, beforeHash: currentHash };
  });

  if (result.kind === "NOT_FOUND") {
    return apiError("NOT_FOUND", "재분석 가능한 충돌 항목을 찾을 수 없습니다.", 404);
  }
  if (result.kind === "TARGET_NOT_FOUND") {
    return apiError("TARGET_NOT_FOUND", "대상 설계를 찾을 수 없습니다.", 404);
  }
  if (result.kind === "NO_DIFFERENCE") {
    return apiError(
      "NO_SPEC_DIFFERENCE",
      "최신 스펙과 새 제안이 같습니다.",
      400,
    );
  }
  return apiSuccess(result);
}
