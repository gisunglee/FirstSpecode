/**
 * 검토 항목 하나의 결정적 스펙 적용 서비스.
 *
 * 대상 조회, hash 충돌 검사, 3-way merge preview, 설계 변경 이력, 연결지도,
 * 마지막 항목의 baseline 전진을 한 트랜잭션 경계에서 처리한다.
 */

import { Prisma } from "@prisma/client";
import { hashOf } from "@/lib/impl-request/diff/normalizer";
import { closeReceiptIfResolved } from "./closeReceipt";
import type {
  ReconcileTargetField,
  ReconcileTargetType,
} from "./contracts";
import { upsertConfirmedSourceLinks } from "./sourceLinks";
import { getTargetSnapshot, updateTargetValue } from "./targetRegistry";
import { mergeDescriptionText } from "./threeWayMerge";

export type ApplySpecItemResult =
  | { kind: "NOT_FOUND" }
  | { kind: "STALE_BASELINE" }
  | { kind: "TARGET_NOT_FOUND" }
  | { kind: "UNSUPPORTED_TARGET" }
  | { kind: "STALE_SPEC"; conflicts: Prisma.JsonValue }
  | { kind: "MERGE_AVAILABLE"; mergedValue: string; currentHash: string }
  | {
      kind: "APPLIED";
      designChangeId: string;
      receiptClosed: boolean;
      appliedValue: string;
    };

export async function applySpecItem(
  tx: Prisma.TransactionClient,
  input: {
    projectId: string;
    receiptId: string;
    itemId: string;
    memberId: string;
    useMergePreview?: boolean;
    decisionReason?: string;
  },
): Promise<ApplySpecItemResult> {
  const item = await tx.tbSpReconcileItem.findFirst({
    where: {
      item_id: input.itemId,
      receipt_id: input.receiptId,
      item_sttus_code: "PENDING",
      receipt: {
        prjct_id: input.projectId,
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
      before_hash: true,
      before_value_cn: true,
      proposed_value_cn: true,
      merge_preview_cn: true,
      merge_latest_hash: true,
      receipt: {
        select: {
          receipt_id: true,
          ai_task_id: true,
          baseline_version_no: true,
          sourceBaseline: {
            select: { checkpoint_version_no: true },
          },
        },
      },
    },
  });
  if (!item) return { kind: "NOT_FOUND" };
  if (
    item.receipt.sourceBaseline.checkpoint_version_no !==
    item.receipt.baseline_version_no
  ) {
    return { kind: "STALE_BASELINE" };
  }

  const targetType = item.target_ref_ty_code as ReconcileTargetType;
  const targetField = item.target_field_nm as ReconcileTargetField;
  if (
    !["UNIT_WORK", "SCREEN", "AREA", "FUNCTION"].includes(targetType) ||
    !["unit_work_dc", "scrn_dc", "area_dc", "func_dc"].includes(targetField)
  ) {
    return { kind: "UNSUPPORTED_TARGET" };
  }

  const target = await getTargetSnapshot(
    tx,
    input.projectId,
    targetType,
    item.target_ref_id,
    targetField,
  );
  if (!target) return { kind: "TARGET_NOT_FOUND" };

  const currentHash = hashOf(target.value).hash;
  let appliedValue = item.proposed_value_cn;

  if (input.useMergePreview) {
    if (
      !item.merge_preview_cn ||
      !item.merge_latest_hash ||
      currentHash !== item.merge_latest_hash.trim()
    ) {
      return {
        kind: "STALE_SPEC",
        conflicts: {
          reason: "MERGE_PREVIEW_STALE",
          currentHash,
          previewHash: item.merge_latest_hash?.trim() ?? null,
        },
      };
    }
    appliedValue = item.merge_preview_cn;
  } else if (currentHash !== item.before_hash.trim()) {
    const merge = mergeDescriptionText(
      item.before_value_cn,
      target.value,
      item.proposed_value_cn,
    );
    if (merge.clean) {
      await tx.tbSpReconcileItem.update({
        where: { item_id: item.item_id },
        data: {
          merge_preview_cn: merge.merged,
          merge_latest_hash: currentHash,
          merge_conflict_data: Prisma.JsonNull,
          mdfcn_dt: new Date(),
        },
      });
      return {
        kind: "MERGE_AVAILABLE",
        mergedValue: merge.merged,
        currentHash,
      };
    }

    await tx.tbSpReconcileItem.update({
      where: { item_id: item.item_id },
      data: {
        item_sttus_code: "STALE_SPEC",
        decision_code: "STALE_SPEC",
        decision_rsn_cn:
          "후보 생성 뒤 현재 스펙의 같은 구간이 변경되어 자동 병합할 수 없습니다.",
        decision_mber_id: input.memberId,
        decision_dt: new Date(),
        merge_conflict_data: merge.conflicts as Prisma.InputJsonValue,
        mdfcn_dt: new Date(),
      },
    });
    return {
      kind: "STALE_SPEC",
      conflicts: merge.conflicts as Prisma.JsonValue,
    };
  }

  const change = await tx.tbDsDesignChange.create({
    data: {
      prjct_id: input.projectId,
      ref_tbl_nm: target.refTable,
      ref_id: target.targetId,
      chg_type_code: "SPEC_RECONCILIATION",
      chg_rsn_cn:
        input.decisionReason?.trim() ||
        "구현 변경 검토에서 승인된 설계 설명 반영",
      snapshot_data: {
        receiptId: input.receiptId,
        itemId: input.itemId,
        targetType,
        targetField,
        before: target.value,
        proposed: item.proposed_value_cn,
        applied: appliedValue,
        originalBefore: item.before_value_cn,
        originalBeforeHash: item.before_hash.trim(),
        appliedFromMerge: Boolean(input.useMergePreview),
        target: {
          displayId: target.displayId,
          name: target.name,
        },
      },
      ai_req_yn: "Y",
      ai_task_id: item.receipt.ai_task_id,
      chg_mber_id: input.memberId,
    },
  });

  await updateTargetValue(tx, target, appliedValue);
  await tx.tbSpReconcileItem.update({
    where: { item_id: item.item_id },
    data: {
      item_sttus_code: "APPLIED",
      decision_code: "APPLY_SPEC",
      decision_rsn_cn:
        input.decisionReason?.trim() ||
        (input.useMergePreview
          ? "검토자가 3-way 병합 결과의 스펙 적용을 승인했습니다."
          : "검토자가 제안 스펙 적용을 승인했습니다."),
      decision_mber_id: input.memberId,
      decision_dt: new Date(),
      design_change_id: change.chg_id,
      resolved_dt: new Date(),
      mdfcn_dt: new Date(),
    },
  });
  await upsertConfirmedSourceLinks(tx, {
    projectId: input.projectId,
    receiptId: input.receiptId,
    targetType,
    targetId: target.targetId,
    evidence: item.source_evidence_data,
  });

  const close = await closeReceiptIfResolved(
    tx,
    input.receiptId,
    input.memberId,
  );
  return {
    kind: "APPLIED",
    designChangeId: change.chg_id,
    receiptClosed: close.closed,
    appliedValue,
  };
}
