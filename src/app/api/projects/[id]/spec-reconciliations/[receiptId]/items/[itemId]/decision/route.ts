/**
 * 정합성 항목 통합 결정 API.
 *
 * APPLY_SPEC / FIX_SOURCE / NO_SPEC_CHANGE / ACCEPT_EXCEPTION / MODEL_GAP /
 * DEFERRED를 한 계약으로 처리한다. APPLY_SPEC은 기존 개별 API와 같은 공통 서비스를 쓴다.
 */

import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { hashOf } from "@/lib/impl-request/diff/normalizer";
import { requirePermission } from "@/lib/requirePermission";
import { applySpecItem } from "@/lib/spec-reconciliation/applySpecItem";
import {
  closeReceiptIfResolved,
  markReceiptStaleBaseline,
  StaleBaselineConflict,
} from "@/lib/spec-reconciliation/closeReceipt";
import type { ReconcileTargetType } from "@/lib/spec-reconciliation/contracts";
import { upsertConfirmedSourceLinks } from "@/lib/spec-reconciliation/sourceLinks";
import { getTargetSnapshot } from "@/lib/spec-reconciliation/targetRegistry";

type RouteParams = {
  params: Promise<{ id: string; receiptId: string; itemId: string }>;
};

const requestSchema = z.object({
  action: z.enum([
    "APPLY_SPEC",
    "FIX_SOURCE",
    "NO_SPEC_CHANGE",
    "ACCEPT_EXCEPTION",
    "MODEL_GAP",
    "DEFERRED",
  ]),
  reason: z.string().trim().max(4_000).optional(),
  useMergePreview: z.boolean().optional(),
  exceptionOwnerMemberId: z.string().trim().max(36).optional(),
  exceptionExpiresAt: z.string().datetime().optional(),
  reviewerMemberId: z.string().trim().max(36).optional(),
}).superRefine((value, context) => {
  if (
    ["FIX_SOURCE", "NO_SPEC_CHANGE", "ACCEPT_EXCEPTION", "MODEL_GAP", "DEFERRED"]
      .includes(value.action) &&
    !value.reason
  ) {
    context.addIssue({
      code: "custom",
      path: ["reason"],
      message: "이 결정에는 사유가 필요합니다.",
    });
  }
  if (
    value.action === "ACCEPT_EXCEPTION" &&
    (!value.exceptionOwnerMemberId || !value.exceptionExpiresAt)
  ) {
    context.addIssue({
      code: "custom",
      path: ["exceptionExpiresAt"],
      message: "임시 예외에는 담당자와 만료일이 필요합니다.",
    });
  }
  if (value.action === "MODEL_GAP" && !value.reviewerMemberId) {
    context.addIssue({
      code: "custom",
      path: ["reviewerMemberId"],
      message: "설계 모델 보완 검토자가 필요합니다.",
    });
  }
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
      "검토 결정 정보가 올바르지 않습니다.",
      400,
      { issues: parsed.error.issues },
    );
  }
  const body = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      if (body.action === "APPLY_SPEC") {
        return applySpecItem(tx, {
          projectId,
          receiptId,
          itemId,
          memberId: gate.mberId,
          useMergePreview: body.useMergePreview,
          decisionReason: body.reason,
        });
      }

      const item = await tx.tbSpReconcileItem.findFirst({
        where: {
          item_id: itemId,
          receipt_id: receiptId,
          item_sttus_code: "PENDING",
          receipt: {
            prjct_id: projectId,
            receipt_sttus_code: "NEEDS_REVIEW",
            review_sttus_code: "NEEDS_REVIEW",
          },
        },
        select: {
          item_id: true,
          target_ref_ty_code: true,
          target_ref_id: true,
          target_field_nm: true,
          source_evidence_data: true,
          source_fact_cn: true,
          receipt: {
            select: {
              ai_task_id: true,
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
        item.receipt.baseline_version_no !==
        item.receipt.sourceBaseline.checkpoint_version_no
      ) {
        return { kind: "STALE_BASELINE" as const };
      }

      if (body.action === "DEFERRED") {
        await tx.tbSpReconcileItem.update({
          where: { item_id: itemId },
          data: {
            decision_code: "DEFERRED",
            decision_rsn_cn: body.reason!,
            decision_mber_id: gate.mberId,
            decision_dt: new Date(),
            mdfcn_dt: new Date(),
          },
        });
        return { kind: "DEFERRED" as const, receiptClosed: false };
      }

      const target = await getTargetSnapshot(
        tx,
        projectId,
        item.target_ref_ty_code as ReconcileTargetType,
        item.target_ref_id,
        item.target_field_nm as never,
      );
      if (!target) return { kind: "TARGET_NOT_FOUND" as const };

      if (body.action === "FIX_SOURCE") {
        const followupTaskId = randomUUID();
        await tx.tbAiTask.create({
          data: {
            ai_task_id: followupTaskId,
            prjct_id: projectId,
            ref_ty_code: item.target_ref_ty_code,
            ref_id: item.target_ref_id,
            task_ty_code: "IMPLEMENT",
            req_cn:
              `스펙 정합성 검토에서 소스 수정이 결정되었습니다.\n\n` +
              `대상: ${target.displayId} ${target.name}\n` +
              `필드: ${item.target_field_nm}\n` +
              `결정 사유: ${body.reason}\n\n` +
              `스펙은 변경하지 말고 현재 스펙에 맞도록 소스를 수정한 뒤, ` +
              `/sync-specode로 보완 증거를 제출하세요.`,
            req_snapshot_data: {
              receiptId,
              itemId,
              sourceFact: item.source_fact_cn,
              sourceEvidence: item.source_evidence_data,
            },
            parent_task_id: item.receipt.ai_task_id,
            req_mber_id: gate.mberId,
            task_sttus_code: "PENDING",
          },
        });
        await tx.tbSpImplSnapshot.create({
          data: {
            ai_task_id: followupTaskId,
            ref_tbl_nm: target.refTable,
            ref_id: target.targetId,
            content_hash: hashOf(target.value).hash,
            raw_cn: target.value,
          },
        });
        await tx.tbSpReconcileItem.update({
          where: { item_id: itemId },
          data: {
            item_sttus_code: "AWAITING_SOURCE_FIX",
            decision_code: "FIX_SOURCE",
            decision_rsn_cn: body.reason!,
            decision_mber_id: gate.mberId,
            decision_dt: new Date(),
            followup_task_id: followupTaskId,
            mdfcn_dt: new Date(),
          },
        });
        return {
          kind: "FIX_SOURCE" as const,
          followupTaskId,
          receiptClosed: false,
        };
      }

      if (body.action === "ACCEPT_EXCEPTION") {
        const expiresAt = new Date(body.exceptionExpiresAt!);
        if (expiresAt <= new Date()) {
          return { kind: "INVALID_EXCEPTION_DATE" as const };
        }
        const owner = await tx.tbPjProjectMember.findFirst({
          where: {
            prjct_id: projectId,
            mber_id: body.exceptionOwnerMemberId!,
            mber_sttus_code: "ACTIVE",
          },
          select: { mber_id: true },
        });
        if (!owner) return { kind: "INVALID_EXCEPTION_OWNER" as const };

        const followupTaskId = randomUUID();
        await tx.tbAiTask.create({
          data: {
            ai_task_id: followupTaskId,
            prjct_id: projectId,
            ref_ty_code: item.target_ref_ty_code,
            ref_id: item.target_ref_id,
            task_ty_code: "CUSTOM",
            req_cn:
              `임시 구현 예외 만료 점검\n\n대상: ${target.displayId} ${target.name}\n` +
              `만료일: ${expiresAt.toISOString()}\n사유: ${body.reason}`,
            req_snapshot_data: { receiptId, itemId, kind: "TEMPORARY_EXCEPTION" },
            req_mber_id: body.exceptionOwnerMemberId,
            exec_avlbl_dt: expiresAt,
            task_sttus_code: "PENDING",
          },
        });
        await tx.tbSpReconcileItem.update({
          where: { item_id: itemId },
          data: {
            item_sttus_code: "RESOLVED",
            decision_code: "ACCEPT_EXCEPTION",
            decision_rsn_cn: body.reason!,
            decision_mber_id: gate.mberId,
            decision_dt: new Date(),
            exception_expire_dt: expiresAt,
            exception_owner_mber_id: body.exceptionOwnerMemberId,
            followup_task_id: followupTaskId,
            resolved_dt: new Date(),
            mdfcn_dt: new Date(),
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
          kind: "ACCEPT_EXCEPTION" as const,
          followupTaskId,
          receiptClosed: close.closed,
        };
      }

      if (body.action === "MODEL_GAP") {
        const reviewer = await tx.tbPjProjectMember.findFirst({
          where: {
            prjct_id: projectId,
            mber_id: body.reviewerMemberId!,
            mber_sttus_code: "ACTIVE",
          },
          select: { mber_id: true },
        });
        if (!reviewer) return { kind: "INVALID_REVIEWER" as const };
        const reviewId = randomUUID();
        await tx.tb_ds_review_request.create({
          data: {
            review_id: reviewId,
            prjct_id: projectId,
            ref_tbl_nm: target.refTable,
            ref_id: target.targetId,
            review_title_nm:
              `[스펙 모델 보완] ${target.displayId} ${target.name}`,
            review_cn:
              `${body.reason}\n\n확인된 소스 사실:\n${item.source_fact_cn}\n\n` +
              `정합성 접수: ${receiptId}\n항목: ${itemId}`,
            req_mber_id: gate.mberId,
            revwr_mber_id: body.reviewerMemberId!,
            review_sttus_code: "REQUESTED",
          },
        });
        await tx.tbSpReconcileItem.update({
          where: { item_id: itemId },
          data: {
            item_sttus_code: "RESOLVED",
            decision_code: "MODEL_GAP",
            decision_rsn_cn: body.reason!,
            decision_mber_id: gate.mberId,
            decision_dt: new Date(),
            review_request_id: reviewId,
            resolved_dt: new Date(),
            mdfcn_dt: new Date(),
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
          kind: "MODEL_GAP" as const,
          reviewId,
          receiptClosed: close.closed,
        };
      }

      await tx.tbSpReconcileItem.update({
        where: { item_id: itemId },
        data: {
          item_sttus_code: "NO_SPEC_CHANGE",
          decision_code: "NO_SPEC_CHANGE",
          decision_rsn_cn: body.reason!,
          decision_mber_id: gate.mberId,
          decision_dt: new Date(),
          resolved_dt: new Date(),
          mdfcn_dt: new Date(),
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
        kind: "NO_SPEC_CHANGE" as const,
        receiptClosed: close.closed,
      };
    });

    if (result.kind === "NOT_FOUND") {
      return apiError("NOT_FOUND", "결정 가능한 검토 항목을 찾을 수 없습니다.", 404);
    }
    if (result.kind === "STALE_BASELINE") {
      await markReceiptStaleBaseline(receiptId);
      return apiError(
        "STALE_BASELINE",
        "다른 접수가 baseline을 먼저 전진시켰습니다.",
        409,
      );
    }
    if (result.kind === "TARGET_NOT_FOUND") {
      return apiError("TARGET_NOT_FOUND", "대상 설계를 찾을 수 없습니다.", 404);
    }
    if (result.kind === "INVALID_EXCEPTION_DATE") {
      return apiError("VALIDATION_ERROR", "예외 만료일은 미래여야 합니다.", 400);
    }
    if (result.kind === "INVALID_EXCEPTION_OWNER") {
      return apiError("VALIDATION_ERROR", "예외 담당자가 활성 멤버가 아닙니다.", 400);
    }
    if (result.kind === "INVALID_REVIEWER") {
      return apiError("VALIDATION_ERROR", "검토자가 활성 멤버가 아닙니다.", 400);
    }
    if (result.kind === "MERGE_AVAILABLE") {
      return apiError(
        "MERGE_AVAILABLE",
        "3-way 병합 결과를 확인한 뒤 다시 승인해 주세요.",
        409,
        {
          mergedValue: result.mergedValue,
          currentHash: result.currentHash,
        },
      );
    }
    if (result.kind === "STALE_SPEC") {
      return apiError(
        "STALE_SPEC",
        "현재 스펙과 제안이 같은 구간에서 충돌합니다.",
        409,
        { conflicts: result.conflicts },
      );
    }
    if (result.kind === "UNSUPPORTED_TARGET") {
      return apiError("UNSUPPORTED_TARGET", "허용되지 않은 적용 대상입니다.", 400);
    }

    return apiSuccess(result);
  } catch (error) {
    if (error instanceof StaleBaselineConflict) {
      await markReceiptStaleBaseline(error.receiptId);
      return apiError(
        "STALE_BASELINE",
        "baseline 충돌로 결정 전체를 되돌렸습니다.",
        409,
      );
    }
    console.error(
      `[POST /api/projects/${projectId}/spec-reconciliations/${receiptId}/items/${itemId}/decision] 오류:`,
      error,
    );
    return apiError("DB_ERROR", "검토 결정을 저장하지 못했습니다.", 500);
  }
}
