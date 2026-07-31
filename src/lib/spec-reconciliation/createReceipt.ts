/**
 * 구현 편차(Type A)와 후속 수정(Type B)의 공통 receipt 생성 서비스.
 *
 * 수집 경로는 달라도 baseline 검증, 대상 스펙 검증, evidence 저장, 검토함 생성 규칙은
 * 같아야 한다. route는 인증과 신뢰등급 상승 방지만 담당하고 생성 규칙은 여기로 모은다.
 */

import { Prisma } from "@prisma/client";
import { hashOf } from "@/lib/impl-request/diff/normalizer";
import type {
  ReceiptSubmission,
  ReconcileTargetField,
  ReconcileTargetType,
} from "./contracts";
import { isValidCheckpoint } from "./contracts";
import { getTargetSnapshot } from "./targetRegistry";

export class ReceiptSubmissionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

type ImplementationSnapshot = {
  refTable: string;
  refId: string;
  contentHash: string;
  rawContent: string;
};

type CreateReceiptOptions = {
  projectId: string;
  memberId: string;
  originType: "IMPLEMENTATION" | "MAINTENANCE";
  aiTaskId?: string | null;
  allowBaselineCreate: boolean;
  implementationSnapshots?: ImplementationSnapshot[];
};

function baselineCheckpoint(baseline: {
  checkpoint_ty_code: string;
  last_reconciled_commit_sha: string | null;
  last_reconciled_manifest_hash: string | null;
}) {
  return baseline.checkpoint_ty_code === "GIT_COMMIT"
    ? baseline.last_reconciled_commit_sha
    : baseline.last_reconciled_manifest_hash?.trim();
}

function refTableFor(targetType: ReconcileTargetType) {
  return {
    UNIT_WORK: "tb_ds_unit_work",
    SCREEN: "tb_ds_screen",
    AREA: "tb_ds_area",
    FUNCTION: "tb_ds_function",
  }[targetType];
}

export async function createReconciliationReceipt(
  tx: Prisma.TransactionClient,
  body: ReceiptSubmission,
  options: CreateReceiptOptions,
) {
  if (
    !isValidCheckpoint(body.checkpointType, body.baseCheckpoint) ||
    !isValidCheckpoint(
      body.checkpointType,
      body.headCheckpoint,
      body.headStable,
    )
  ) {
    throw new ReceiptSubmissionError(
      "INVALID_CHECKPOINT",
      "checkpoint 값이 선택한 checkpointType 형식과 맞지 않습니다.",
      400,
    );
  }
  if (
    body.checkpointType === "GIT_COMMIT" &&
    body.ancestryVerified === false
  ) {
    throw new ReceiptSubmissionError(
      "INVALID_ANCESTRY",
      "base commit이 head commit의 조상이 아닙니다. branch baseline을 다시 선택해 주세요.",
    );
  }
  if (body.clientSubmissionKey) {
    const existing = await tx.tbSpImplReceipt.findUnique({
      where: {
        prjct_id_client_submission_key: {
          prjct_id: options.projectId,
          client_submission_key: body.clientSubmissionKey,
        },
      },
      select: {
        receipt_id: true,
        receipt_sttus_code: true,
        review_sttus_code: true,
        checkpoint_ty_code: true,
        diff_hash: true,
        baseline_id: true,
        baseline_version_no: true,
        _count: { select: { items: true } },
      },
    });
    if (existing) {
      if (existing.receipt_sttus_code === "DRAFT" && body.headStable) {
        if (
          existing.checkpoint_ty_code !== body.checkpointType ||
          existing.diff_hash?.trim() !== body.diffHash?.toLowerCase() ||
          (!body.analysisScope?.autoBatch &&
            existing._count.items !== body.proposals.length)
        ) {
          throw new ReceiptSubmissionError(
            "DRAFT_FINALIZATION_MISMATCH",
            "DRAFT와 최종 제출의 Diff 또는 후보 구성이 다릅니다. 새 변경으로 다시 제출해 주세요.",
          );
        }
        const baseline = await tx.tbSpSourceBaseline.findUnique({
          where: { baseline_id: existing.baseline_id },
          select: { checkpoint_version_no: true },
        });
        if (
          !baseline ||
          baseline.checkpoint_version_no !== existing.baseline_version_no
        ) {
          throw new ReceiptSubmissionError(
            "STALE_SOURCE_BASELINE",
            "DRAFT 이후 source baseline이 전진했습니다. 최신 기준으로 다시 분석해 주세요.",
          );
        }
        await tx.tbSpImplReceipt.update({
          where: { receipt_id: existing.receipt_id },
          data: {
            head_checkpoint_val: body.headCheckpoint,
            head_stable_yn: "Y",
            source_evidence_data:
              body.sourceEvidence as Prisma.InputJsonValue,
            evidence_verify_code: body.evidenceVerify,
            ancestry_verify_yn:
              body.ancestryVerified == null
                ? null
                : body.ancestryVerified
                  ? "Y"
                  : "N",
            evidence_verify_data: body.evidenceVerifyData
              ? body.evidenceVerifyData as Prisma.InputJsonValue
              : Prisma.JsonNull,
            manifest_data: body.manifest
              ? body.manifest as Prisma.InputJsonValue
              : Prisma.JsonNull,
            analysis_scope_data: body.analysisScope
              ? body.analysisScope as Prisma.InputJsonValue
              : Prisma.JsonNull,
            receipt_sttus_code: "NEEDS_REVIEW",
            review_sttus_code:
              existing.review_sttus_code === "DRAFT"
                ? "NEEDS_REVIEW"
                : existing.review_sttus_code,
            mdfcn_dt: new Date(),
          },
        });
        return {
          receiptId: existing.receipt_id,
          status: "NEEDS_REVIEW",
          itemCount: existing._count.items,
          idempotent: true,
          finalizedDraft: true,
        };
      }
      return {
        receiptId: existing.receipt_id,
        status: existing.receipt_sttus_code,
        itemCount: existing._count.items,
        idempotent: true,
        finalizedDraft: false,
      };
    }
  }
  if (options.aiTaskId) {
    const existing = await tx.tbSpImplReceipt.findUnique({
      where: { ai_task_id: options.aiTaskId },
      select: {
        receipt_id: true,
        receipt_sttus_code: true,
        _count: { select: { items: true } },
      },
    });
    if (existing) {
      return {
        receiptId: existing.receipt_id,
        status: existing.receipt_sttus_code,
        itemCount: existing._count.items,
        idempotent: true,
        finalizedDraft: false,
      };
    }
  }

  const scope = {
    prjct_id_repo_key_branch_nm: {
      prjct_id: options.projectId,
      repo_key: body.repoKey,
      branch_nm: body.branchName,
    },
  };
  let baseline = await tx.tbSpSourceBaseline.findUnique({ where: scope });
  if (!baseline) {
    if (!options.allowBaselineCreate) {
      throw new ReceiptSubmissionError(
        "SOURCE_BASELINE_REQUIRED",
        "후속 변경을 비교할 source baseline이 없습니다. 프로젝트에서 최초 기준선을 승인해 주세요.",
        412,
      );
    }
    baseline = await tx.tbSpSourceBaseline.create({
      data: {
        prjct_id: options.projectId,
        repo_key: body.repoKey,
        repo_provider_code: body.repoProvider,
        branch_nm: body.branchName,
        checkpoint_ty_code: body.checkpointType,
        last_reconciled_commit_sha:
          body.checkpointType === "GIT_COMMIT" ? body.baseCheckpoint : null,
        last_reconciled_manifest_hash:
          body.checkpointType === "SOURCE_MANIFEST"
            ? body.baseCheckpoint
            : null,
        checkpoint_version_no: 0,
        history_audit_code: "NOT_AUDITED",
        checkpoint_metadata_data: {
          initializedBy: "IMPLEMENTATION_RECEIPT",
          evidenceTrust: body.evidenceTrust,
        },
      },
    });
  } else if (
    baseline.checkpoint_ty_code !== body.checkpointType ||
    baselineCheckpoint(baseline) !== body.baseCheckpoint
  ) {
    throw new ReceiptSubmissionError(
      "STALE_SOURCE_BASELINE",
      "제출한 base source가 현재 SPECODE source baseline과 다릅니다. 최신 기준으로 다시 분석해 주세요.",
    );
  }

  const duplicateTargets = new Set<string>();
  const targetSnapshots = [];
  const implementationSnapshots = new Map(
    (options.implementationSnapshots ?? []).map((snapshot) => [
      `${snapshot.refTable}:${snapshot.refId}`,
      snapshot,
    ]),
  );

  for (const proposal of body.proposals) {
    const targetKey =
      `${proposal.targetRefType}:${proposal.targetRefId}:${proposal.targetField}`;
    if (duplicateTargets.has(targetKey)) {
      throw new ReceiptSubmissionError(
        "DUPLICATE_TARGET",
        "같은 설계 필드는 receipt 안에서 한 번만 제안할 수 있습니다.",
      );
    }
    duplicateTargets.add(targetKey);

    const target = await getTargetSnapshot(
      tx,
      options.projectId,
      proposal.targetRefType,
      proposal.targetRefId,
      proposal.targetField,
    );
    if (!target) {
      throw new ReceiptSubmissionError(
        "TARGET_NOT_FOUND",
        "제안 대상 설계 일부가 프로젝트에 없거나 허용되지 않은 필드입니다.",
        404,
      );
    }

    const beforeHash = hashOf(proposal.beforeValue).hash;
    if (beforeHash !== proposal.beforeHash.toLowerCase()) {
      throw new ReceiptSubmissionError(
        "BEFORE_HASH_MISMATCH",
        "제안의 beforeValue와 beforeHash가 일치하지 않습니다.",
        400,
      );
    }
    if (hashOf(proposal.proposedValue).hash === beforeHash) {
      throw new ReceiptSubmissionError(
        "NO_SPEC_DIFFERENCE",
        "변경 전과 제안 설명이 같은 항목은 proposal로 제출할 수 없습니다.",
        400,
      );
    }

    if (options.originType === "IMPLEMENTATION") {
      const snapshot = implementationSnapshots.get(
        `${refTableFor(proposal.targetRefType)}:${proposal.targetRefId}`,
      );
      if (
        !snapshot ||
        snapshot.rawContent !== proposal.beforeValue ||
        snapshot.contentHash.trim() !== proposal.beforeHash.toLowerCase()
      ) {
        throw new ReceiptSubmissionError(
          "SNAPSHOT_MISMATCH",
          "제안의 변경 전 설명이 구현요청 당시 스냅샷과 일치하지 않습니다.",
        );
      }
    } else if (
      target.value !== proposal.beforeValue ||
      hashOf(target.value).hash !== proposal.beforeHash.toLowerCase()
    ) {
      throw new ReceiptSubmissionError(
        "CURRENT_SPEC_MISMATCH",
        "후속 변경 분석에 사용한 스펙이 이미 바뀌었습니다. 최신 스펙으로 다시 분석해 주세요.",
      );
    }
    targetSnapshots.push({ proposal, target });
  }

  const riskSummary = body.proposals.reduce<Record<string, number>>(
    (summary, proposal) => {
      summary[proposal.risk] = (summary[proposal.risk] ?? 0) + 1;
      return summary;
    },
    { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
  );
  const isDraft = !body.headStable;
  const receipt = await tx.tbSpImplReceipt.create({
    data: {
      prjct_id: options.projectId,
      origin_ty_code: options.originType,
      client_submission_key: body.clientSubmissionKey ?? null,
      parent_receipt_id: body.parentReceiptId ?? null,
      ai_task_id: options.aiTaskId ?? null,
      baseline_id: baseline.baseline_id,
      baseline_version_no: baseline.checkpoint_version_no,
      base_checkpoint_val: body.baseCheckpoint,
      head_checkpoint_val: body.headCheckpoint,
      checkpoint_ty_code: body.checkpointType,
      source_evidence_data: body.sourceEvidence as Prisma.InputJsonValue,
      evidence_trust_code: body.evidenceTrust,
      evidence_verify_code: body.evidenceVerify,
      ancestry_verify_yn:
        body.ancestryVerified === undefined || body.ancestryVerified === null
          ? null
          : body.ancestryVerified
            ? "Y"
            : "N",
      diff_hash: body.diffHash?.toLowerCase() ?? null,
      evidence_verify_data: body.evidenceVerifyData
        ? body.evidenceVerifyData as Prisma.InputJsonValue
        : Prisma.JsonNull,
      pr_url: body.prUrl ?? null,
      summary_cn: body.summary || null,
      manifest_data: body.manifest
        ? body.manifest as Prisma.InputJsonValue
        : Prisma.JsonNull,
      selected_target_data: body.selectedTargets
        ? body.selectedTargets as Prisma.InputJsonValue
        : Prisma.JsonNull,
      analysis_scope_data: body.analysisScope
        ? body.analysisScope as Prisma.InputJsonValue
        : Prisma.JsonNull,
      risk_summary_data: riskSummary,
      review_sttus_code: isDraft ? "DRAFT" : "NEEDS_REVIEW",
      analysis_version: body.analysisVersion ?? "spec-reconcile/v2",
      head_stable_yn: isDraft ? "N" : "Y",
      receipt_sttus_code: isDraft ? "DRAFT" : "NEEDS_REVIEW",
      submit_mber_id: options.memberId,
      items: {
        create: targetSnapshots.map(({ proposal, target }) => ({
          classification_code: proposal.classification,
          target_ref_ty_code: proposal.targetRefType,
          target_ref_id: proposal.targetRefId,
          target_field_nm: proposal.targetField,
          target_hierarchy_data: target.hierarchy,
          source_evidence_data:
            proposal.sourceEvidence as Prisma.InputJsonValue,
          source_fact_cn: proposal.sourceFact,
          inferred_impact_cn: proposal.inferredImpact || null,
          before_value_cn: proposal.beforeValue,
          proposed_value_cn: proposal.proposedValue,
          before_hash: proposal.beforeHash.toLowerCase(),
          risk_code: proposal.risk,
          confidence_code: proposal.confidence,
        })),
      },
    },
  });

  return {
    receiptId: receipt.receipt_id,
    status: receipt.receipt_sttus_code,
    itemCount: body.proposals.length,
    idempotent: false,
    finalizedDraft: false,
  };
}
