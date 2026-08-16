/** 사람의 항목별 적용·거부·보류를 단일 트랜잭션으로 처리한다. */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { syncDecisionSchema } from "./contracts";
import { SpecSyncError } from "./errors";
import { hashExactText } from "./hash";
import { assertDecisionEligible } from "./resultValidator";
import { lockTarget, updateLockedTarget } from "./targetRegistry";

export async function decideSyncItem(input: {
  projectId: string;
  runId: string;
  itemId: string;
  memberId: string;
  rawDecision: unknown;
}) {
  const decision = syncDecisionSchema.parse(input.rawDecision);
  return prisma.$transaction(async (tx) => {
    await lockRun(tx, input.projectId, input.runId);
    await lockItem(tx, input.runId, input.itemId);

    const item = await tx.tbSpSyncItem.findUnique({
      where: { sync_item_id: input.itemId },
      include: { run: true },
    });
    if (!item || item.run.sync_run_id !== input.runId) {
      throw new SpecSyncError("NOT_FOUND", "검토 항목을 찾을 수 없습니다.", 404);
    }
    try {
      assertDecisionEligible({
        itemStatus: item.item_sttus_code,
        proposedValue: item.proposed_value_cn,
        decision: decision.decision,
      });
    } catch {
      throw new SpecSyncError(
        "INVALID_ITEM_STATE",
        "현재 상태에서는 이 결정을 처리할 수 없습니다.",
        409,
      );
    }

    const now = new Date();
    if (decision.decision !== "APPLY") {
      await tx.tbSpSyncItem.update({
        where: { sync_item_id: item.sync_item_id },
        data: {
          item_sttus_code:
            decision.decision === "REJECT" ? "REJECTED" : "DEFERRED",
          decision_code: decision.decision,
          decision_rsn_cn: decision.reason,
          decision_mber_id: input.memberId,
          decision_dt: now,
          mdfcn_dt: now,
        },
      });
      const runStatus = await completeRunIfResolved(tx, input.runId, now);
      return {
        kind: decision.decision,
        itemStatus: decision.decision === "REJECT" ? "REJECTED" : "DEFERRED",
        runStatus,
      };
    }

    assertApplicableItem(item);
    const target = await lockTarget(tx, {
      projectId: input.projectId,
      unitWorkId: item.run.unit_work_id!,
      targetType:
        item.target_ref_ty_code as Parameters<typeof lockTarget>[1]["targetType"],
      targetId: item.target_ref_id!,
      targetField:
        item.target_field_nm as Parameters<typeof lockTarget>[1]["targetField"],
    });
    if (!target) {
      throw new SpecSyncError(
        "TARGET_NOT_FOUND",
        "적용 대상이 삭제되었거나 실행 UW 밖으로 이동했습니다.",
        409,
      );
    }

    if (hashExactText(target.value) !== item.before_hash) {
      await tx.tbSpSyncItem.update({
        where: { sync_item_id: item.sync_item_id },
        data: {
          item_sttus_code: "DESIGN_CHANGED",
          decision_code: null,
          decision_rsn_cn: "분석 뒤 현재 설계가 변경되어 자동 적용하지 않았습니다.",
          decision_mber_id: input.memberId,
          decision_dt: now,
          mdfcn_dt: now,
        },
      });
      const runStatus = await completeRunIfResolved(tx, input.runId, now);
      return {
        kind: "DESIGN_CHANGED" as const,
        itemStatus: "DESIGN_CHANGED" as const,
        runStatus,
        analysisValue: item.before_value_cn,
        currentValue: target.value,
        proposedValue: item.proposed_value_cn,
      };
    }

    const change = await tx.tbDsDesignChange.create({
      data: {
        prjct_id: input.projectId,
        ref_tbl_nm: target.refTable,
        ref_id: target.targetId,
        chg_type_code: "SPEC_SYNC",
        chg_rsn_cn:
          decision.reason || "구현-설계 동기화 검토에서 승인된 설명 반영",
        snapshot_data: {
          syncRunId: input.runId,
          syncItemId: input.itemId,
          targetType: target.targetType,
          targetField: target.targetField,
          before: target.value,
          after: item.proposed_value_cn,
          beforeHash: item.before_hash,
        },
        ai_req_yn: "Y",
        chg_mber_id: input.memberId,
      },
    });
    await updateLockedTarget(
      tx,
      target,
      item.proposed_value_cn!,
      input.memberId,
    );
    await tx.tbSpSyncItem.update({
      where: { sync_item_id: item.sync_item_id },
      data: {
        item_sttus_code: "APPLIED",
        decision_code: "APPLY",
        decision_rsn_cn: decision.reason || "제안 설계 반영 승인",
        decision_mber_id: input.memberId,
        decision_dt: now,
        design_change_id: change.chg_id,
        mdfcn_dt: now,
      },
    });
    const runStatus = await completeRunIfResolved(tx, input.runId, now);
    return {
      kind: "APPLIED" as const,
      itemStatus: "APPLIED" as const,
      runStatus,
      designChangeId: change.chg_id,
      appliedValue: item.proposed_value_cn,
    };
  });
}

async function lockRun(
  tx: Prisma.TransactionClient,
  projectId: string,
  runId: string,
) {
  const rows = await tx.$queryRaw<Array<{ sync_run_id: string }>>(Prisma.sql`
    SELECT sync_run_id FROM tb_sp_sync_run
    WHERE sync_run_id = ${runId} AND prjct_id = ${projectId}
    FOR UPDATE
  `);
  if (rows.length !== 1) {
    throw new SpecSyncError("NOT_FOUND", "동기화 실행을 찾을 수 없습니다.", 404);
  }
}

async function lockItem(
  tx: Prisma.TransactionClient,
  runId: string,
  itemId: string,
) {
  const rows = await tx.$queryRaw<Array<{ sync_item_id: string }>>(Prisma.sql`
    SELECT sync_item_id FROM tb_sp_sync_item
    WHERE sync_item_id = ${itemId} AND sync_run_id = ${runId}
    FOR UPDATE
  `);
  if (rows.length !== 1) {
    throw new SpecSyncError("NOT_FOUND", "검토 항목을 찾을 수 없습니다.", 404);
  }
}

function assertApplicableItem(item: {
  target_ref_ty_code: string | null;
  target_ref_id: string | null;
  target_field_nm: string | null;
  before_value_cn: string | null;
  before_hash: string | null;
  proposed_value_cn: string | null;
  run: { unit_work_id: string | null };
}) {
  if (
    !item.target_ref_ty_code ||
    !item.target_ref_id ||
    !item.target_field_nm ||
    item.before_value_cn === null ||
    !item.before_hash ||
    item.proposed_value_cn === null ||
    !item.run.unit_work_id
  ) {
    throw new SpecSyncError(
      "INVALID_ITEM_STATE",
      "자동 적용에 필요한 대상 또는 제안 정보가 없습니다.",
      409,
    );
  }
}

async function completeRunIfResolved(
  tx: Prisma.TransactionClient,
  runId: string,
  now: Date,
) {
  const pendingCount = await tx.tbSpSyncItem.count({
    where: { sync_run_id: runId, item_sttus_code: "PENDING" },
  });
  const status = pendingCount === 0 ? "COMPLETED" : "NEEDS_REVIEW";
  await tx.tbSpSyncRun.update({
    where: { sync_run_id: runId },
    data: {
      sync_sttus_code: status,
      compl_dt: pendingCount === 0 ? now : null,
      mdfcn_dt: now,
    },
  });
  return status;
}
