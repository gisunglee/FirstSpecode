/**
 * 적용된 스펙 변경을 되돌리고, 그 결과 생긴 소스-스펙 불일치를 새 receipt로 연다.
 *
 * CLOSED receipt의 source baseline은 이미 전진했으므로 과거 receipt를 다시 열지 않는다.
 * 대신 현재 source baseline을 기준으로 자식 receipt를 만들어 감사 이력과 미해결 경고를
 * 모두 보존한다.
 */

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { requirePermission } from "@/lib/requirePermission";
import { hashOf } from "@/lib/impl-request/diff/normalizer";
import type {
  ReconcileTargetField,
  ReconcileTargetType,
} from "@/lib/spec-reconciliation/contracts";
import {
  getTargetSnapshot,
  updateTargetValue,
} from "@/lib/spec-reconciliation/targetRegistry";

type RouteParams = {
  params: Promise<{ id: string; receiptId: string; itemId: string }>;
};

const requestSchema = z.object({
  reason: z.string().trim().min(1).max(4_000),
});

class RollbackConflict extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, receiptId, itemId } = await params;
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
    return apiError("VALIDATION_ERROR", "rollback 사유를 입력해 주세요.", 400);
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.tbSpReconcileItem.findFirst({
        where: {
          item_id: itemId,
          receipt_id: receiptId,
          item_sttus_code: "APPLIED",
          receipt: {
            prjct_id: projectId,
            receipt_sttus_code: "CLOSED",
          },
        },
        select: {
          item_id: true,
          classification_code: true,
          target_ref_ty_code: true,
          target_ref_id: true,
          target_field_nm: true,
          target_hierarchy_data: true,
          source_evidence_data: true,
          source_fact_cn: true,
          inferred_impact_cn: true,
          before_value_cn: true,
          proposed_value_cn: true,
          before_hash: true,
          risk_code: true,
          confidence_code: true,
          design_change_id: true,
          receipt: {
            select: {
              receipt_id: true,
              baseline_id: true,
              source_evidence_data: true,
              evidence_trust_code: true,
              evidence_verify_code: true,
              ancestry_verify_yn: true,
              diff_hash: true,
              evidence_verify_data: true,
              override_rsn_cn: true,
              override_mber_id: true,
              pr_url: true,
              manifest_data: true,
              selected_target_data: true,
              analysis_version: true,
              sourceBaseline: true,
            },
          },
        },
      });
      if (!item || !item.design_change_id) {
        throw new RollbackConflict(
          "ROLLBACK_NOT_AVAILABLE",
          "정합성 확정까지 끝난 적용 항목만 rollback할 수 있습니다.",
          404,
        );
      }

      const designChange = await tx.tbDsDesignChange.findUnique({
        where: { chg_id: item.design_change_id },
        select: { snapshot_data: true },
      });
      const snapshot = asRecord(designChange?.snapshot_data);
      const appliedValue =
        typeof snapshot?.applied === "string"
          ? snapshot.applied
          : item.proposed_value_cn;
      const rollbackValue =
        typeof snapshot?.before === "string"
          ? snapshot.before
          : item.before_value_cn;

      const targetType = item.target_ref_ty_code as ReconcileTargetType;
      const targetField = item.target_field_nm as ReconcileTargetField;
      const target = await getTargetSnapshot(
        tx,
        projectId,
        targetType,
        item.target_ref_id,
        targetField,
      );
      if (!target) {
        throw new RollbackConflict(
          "TARGET_NOT_FOUND",
          "rollback 대상 스펙을 찾을 수 없습니다.",
          404,
        );
      }
      if (target.value !== appliedValue) {
        throw new RollbackConflict(
          "ROLLBACK_SPEC_CHANGED",
          "적용 이후 스펙이 다시 변경되어 자동 rollback할 수 없습니다.",
        );
      }

      const baseline = item.receipt.sourceBaseline;
      const currentCheckpoint =
        baseline.checkpoint_ty_code === "GIT_COMMIT"
          ? baseline.last_reconciled_commit_sha
          : baseline.last_reconciled_manifest_hash?.trim();
      if (!currentCheckpoint) {
        throw new RollbackConflict(
          "BASELINE_CHECKPOINT_MISSING",
          "현재 source baseline checkpoint가 없어 rollback receipt를 만들 수 없습니다.",
        );
      }

      const rollbackChange = await tx.tbDsDesignChange.create({
        data: {
          prjct_id: projectId,
          ref_tbl_nm: target.refTable,
          ref_id: target.targetId,
          chg_type_code: "SPEC_RECONCILIATION_ROLLBACK",
          chg_rsn_cn: parsed.data.reason,
          snapshot_data: {
            receiptId,
            itemId,
            rollbackOfDesignChangeId: item.design_change_id,
            beforeRollback: appliedValue,
            afterRollback: rollbackValue,
          },
          ai_req_yn: "N",
          chg_mber_id: gate.mberId,
        },
      });
      await updateTargetValue(tx, target, rollbackValue);

      const child = await tx.tbSpImplReceipt.create({
        data: {
          prjct_id: projectId,
          origin_ty_code: "ROLLBACK",
          parent_receipt_id: receiptId,
          baseline_id: baseline.baseline_id,
          baseline_version_no: baseline.checkpoint_version_no,
          base_checkpoint_val: currentCheckpoint,
          head_checkpoint_val: currentCheckpoint,
          checkpoint_ty_code: baseline.checkpoint_ty_code,
          source_evidence_data:
            item.receipt.source_evidence_data as Prisma.InputJsonValue,
          evidence_trust_code: item.receipt.evidence_trust_code,
          evidence_verify_code: item.receipt.evidence_verify_code,
          ancestry_verify_yn: item.receipt.ancestry_verify_yn,
          diff_hash: item.receipt.diff_hash?.trim() ?? null,
          evidence_verify_data: item.receipt.evidence_verify_data
            ? item.receipt.evidence_verify_data as Prisma.InputJsonValue
            : Prisma.JsonNull,
          override_rsn_cn: item.receipt.override_rsn_cn,
          override_mber_id: item.receipt.override_mber_id,
          pr_url: item.receipt.pr_url,
          manifest_data: item.receipt.manifest_data
            ? item.receipt.manifest_data as Prisma.InputJsonValue
            : Prisma.JsonNull,
          selected_target_data: item.receipt.selected_target_data
            ? item.receipt.selected_target_data as Prisma.InputJsonValue
            : Prisma.JsonNull,
          summary_cn: `Rollback 후 재검토 · ${target.displayId} ${target.name}`,
          analysis_version:
            item.receipt.analysis_version ?? "spec-reconcile/v2",
          head_stable_yn: "Y",
          review_sttus_code: "NEEDS_REVIEW",
          receipt_sttus_code: "NEEDS_REVIEW",
          submit_mber_id: gate.mberId,
          risk_summary_data: {
            LOW: item.risk_code === "LOW" ? 1 : 0,
            MEDIUM: item.risk_code === "MEDIUM" ? 1 : 0,
            HIGH: item.risk_code === "HIGH" ? 1 : 0,
            CRITICAL: item.risk_code === "CRITICAL" ? 1 : 0,
          },
          items: {
            create: {
              classification_code: item.classification_code,
              target_ref_ty_code: item.target_ref_ty_code,
              target_ref_id: item.target_ref_id,
              target_field_nm: item.target_field_nm,
              target_hierarchy_data:
                item.target_hierarchy_data as Prisma.InputJsonValue,
              source_evidence_data:
                item.source_evidence_data as Prisma.InputJsonValue,
              source_fact_cn:
                `${item.source_fact_cn}\n\n` +
                `승인된 스펙 적용이 rollback되어 현재 소스와 스펙이 다시 다릅니다.`,
              inferred_impact_cn: item.inferred_impact_cn,
              before_value_cn: rollbackValue,
              proposed_value_cn: appliedValue,
              before_hash: hashOf(rollbackValue).hash,
              risk_code: item.risk_code,
              confidence_code: item.confidence_code,
            },
          },
        },
      });

      await tx.tbSpReconcileItem.update({
        where: { item_id: itemId },
        data: {
          item_sttus_code: "ROLLED_BACK",
          decision_code: "ROLLED_BACK",
          decision_rsn_cn: parsed.data.reason,
          decision_mber_id: gate.mberId,
          decision_dt: new Date(),
          resolution_evidence_data: {
            rollbackDesignChangeId: rollbackChange.chg_id,
            childReceiptId: child.receipt_id,
          },
          resolved_dt: new Date(),
          mdfcn_dt: new Date(),
        },
      });

      return {
        rollbackDesignChangeId: rollbackChange.chg_id,
        childReceiptId: child.receipt_id,
      };
    });

    return apiSuccess(result);
  } catch (error) {
    if (error instanceof RollbackConflict) {
      return apiError(error.code, error.message, error.status);
    }
    console.error(
      `[POST /api/projects/${projectId}/spec-reconciliations/${receiptId}` +
        `/items/${itemId}/rollback] 오류:`,
      error,
    );
    return apiError("DB_ERROR", "스펙 적용 rollback에 실패했습니다.", 500);
  }
}

function asRecord(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, Prisma.JsonValue>;
}
