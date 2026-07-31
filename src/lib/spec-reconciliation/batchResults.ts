/**
 * Router/분석 배치 결과 검증과 receipt 단위 병합.
 *
 * 배치별 LLM 결과는 즉시 저장한다. 모든 분석 배치가 끝난 뒤에만 최종 item을 만들며,
 * 동일 대상의 다른 제안은 임의 선택하지 않고 BATCH_CONFLICT로 노출한다.
 */

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { hashOf } from "@/lib/impl-request/diff/normalizer";
import { reconcileProposalSchema } from "./contracts";
import {
  routerResultSchema,
  type BatchTargetRef,
  type FileAssignment,
} from "./batchContracts";
import {
  BatchPlanningError,
  createAnalysisBatchesFromRouter,
} from "./batchPlanner";
import { mergeBatchProposalOrigins } from "./batchMerge";

const batchAnalysisResultSchema = z.object({
  summary: z.string().trim().max(4_000).optional(),
  analysisVersion: z.string().trim().max(50).optional(),
  proposals: z.array(reconcileProposalSchema).max(500),
});

type ValidatedBatchResult = z.infer<typeof batchAnalysisResultSchema>;

export async function applyReconciliationRouterResult(
  tx: Prisma.TransactionClient,
  batchId: string,
  rawResult: string,
) {
  const parsed = routerResultSchema.safeParse(parseJsonResult(rawResult));
  if (!parsed.success) {
    return markReconciliationBatchFailed(
      tx,
      batchId,
      `AI router JSON 검증 실패: ${parsed.error.issues[0]?.message ?? "형식 오류"}`,
    );
  }
  try {
    const batches = await createAnalysisBatchesFromRouter(
      tx,
      batchId,
      parsed.data.assignments as FileAssignment[],
    );
    return { applied: true, batchCount: batches.length };
  } catch (error) {
    return markReconciliationBatchFailed(
      tx,
      batchId,
      error instanceof Error ? error.message : "라우팅 결과 적용 실패",
    );
  }
}

export async function applyReconciliationBatchResult(
  tx: Prisma.TransactionClient,
  batchId: string,
  rawResult: string,
) {
  const pointer = await tx.tbSpReconcileBatch.findUnique({
    where: { batch_id: batchId },
    select: { receipt_id: true },
  });
  if (pointer) await lockReceipt(tx, pointer.receipt_id);
  const batch = await tx.tbSpReconcileBatch.findUnique({
    where: { batch_id: batchId },
    select: {
      batch_id: true,
      receipt_id: true,
      scope_ty_code: true,
      source_paths_data: true,
      target_refs_data: true,
      batch_sttus_code: true,
    },
  });
  if (batch?.batch_sttus_code === "SUPERSEDED") {
    return { applied: false, reason: "BATCH_SUPERSEDED" };
  }
  if (!batch || batch.scope_ty_code === "ROUTER") {
    return markReconciliationBatchFailed(
      tx,
      batchId,
      "분석 배치를 찾을 수 없습니다.",
    );
  }
  if (batch.batch_sttus_code !== "ANALYZING") {
    return markReconciliationBatchFailed(
      tx,
      batchId,
      `완료 가능한 배치 상태가 아닙니다: ${batch.batch_sttus_code}`,
    );
  }
  const parsed = batchAnalysisResultSchema.safeParse(parseJsonResult(rawResult));
  if (!parsed.success) {
    return markReconciliationBatchFailed(
      tx,
      batchId,
      `AI 배치 JSON 검증 실패: ${parsed.error.issues[0]?.message ?? "형식 오류"}`,
    );
  }
  const targets = parseTargetRefs(batch.target_refs_data);
  const allowedSourcePaths = new Set(stringArray(batch.source_paths_data));
  const targetMap = new Map(
    targets.map((target) => [targetKey(target), target]),
  );
  const seen = new Set<string>();
  for (const proposal of parsed.data.proposals) {
    const key = proposalKey(proposal);
    if (seen.has(key)) {
      return markReconciliationBatchFailed(
        tx,
        batchId,
        `배치 안에 중복 제안 대상이 있습니다: ${key}`,
      );
    }
    seen.add(key);
    const target = targetMap.get(key);
    if (!target) {
      return markReconciliationBatchFailed(
        tx,
        batchId,
        `배치 범위 밖의 제안 대상입니다: ${key}`,
      );
    }
    if (
      proposal.beforeValue !== target.description ||
      proposal.beforeHash.toLowerCase() !== target.descriptionHash.toLowerCase()
    ) {
      return markReconciliationBatchFailed(
        tx,
        batchId,
        `설계 원문 또는 hash가 배치 snapshot과 다릅니다: ${key}`,
      );
    }
    if (hashOf(proposal.proposedValue).hash === proposal.beforeHash.toLowerCase()) {
      return markReconciliationBatchFailed(
        tx,
        batchId,
        `변경 내용이 없는 제안입니다: ${key}`,
      );
    }
    const citedPaths = evidencePaths(proposal.sourceEvidence);
    if (citedPaths.length === 0) {
      return markReconciliationBatchFailed(
        tx,
        batchId,
        `제안에 source evidence 파일 경로가 없습니다: ${key}`,
      );
    }
    const outsidePath = citedPaths.find((path) => !allowedSourcePaths.has(path));
    if (outsidePath) {
      return markReconciliationBatchFailed(
        tx,
        batchId,
        `배치 범위 밖의 source evidence 경로입니다: ${outsidePath}`,
      );
    }
  }

  await tx.tbSpReconcileBatch.update({
    where: { batch_id: batchId },
    data: {
      batch_sttus_code: "COMPLETED",
      analysis_result_data: parsed.data as Prisma.InputJsonValue,
      summary_cn: parsed.data.summary ?? null,
      failure_cn: null,
      compl_dt: new Date(),
      mdfcn_dt: new Date(),
    },
  });
  const merged = await mergeReceiptBatchesIfReady(tx, batch.receipt_id);
  return { applied: true, ...merged };
}

export async function markReconciliationBatchFailed(
  tx: Prisma.TransactionClient,
  batchId: string,
  reason: string,
) {
  const batch = await tx.tbSpReconcileBatch.findUnique({
    where: { batch_id: batchId },
    select: { receipt_id: true, batch_sttus_code: true },
  });
  if (!batch) return { applied: false, reason: "BATCH_NOT_FOUND" };
  if (batch.batch_sttus_code === "SUPERSEDED") {
    return { applied: false, reason: "BATCH_SUPERSEDED" };
  }
  await tx.tbSpReconcileBatch.update({
    where: { batch_id: batchId },
    data: {
      batch_sttus_code: "FAILED",
      failure_cn: reason.slice(0, 20_000),
      compl_dt: new Date(),
      mdfcn_dt: new Date(),
    },
  });
  await tx.tbSpImplReceipt.update({
    where: { receipt_id: batch.receipt_id },
    data: {
      review_sttus_code: "ANALYSIS_PARTIAL_FAILED",
      mdfcn_dt: new Date(),
    },
  });
  return { applied: false, reason };
}

export async function mergeReceiptBatchesIfReady(
  tx: Prisma.TransactionClient,
  receiptId: string,
) {
  // 마지막 두 배치가 동시에 끝나도 한 트랜잭션은 다른 쪽의 commit 이후 다시 읽는다.
  // 이 잠금이 없으면 둘 다 상대 배치를 ANALYZING으로 보고 병합을 건너뛸 수 있다.
  await lockReceipt(tx, receiptId);
  const receipt = await tx.tbSpImplReceipt.findUnique({
    where: { receipt_id: receiptId },
    select: {
      receipt_id: true,
      receipt_sttus_code: true,
      items: { select: { item_sttus_code: true } },
      batches: {
        where: {
          scope_ty_code: { not: "ROUTER" },
          batch_sttus_code: { not: "SUPERSEDED" },
        },
        orderBy: { batch_no: "asc" },
        select: {
          batch_id: true,
          scope_nm: true,
          batch_sttus_code: true,
          target_refs_data: true,
          analysis_result_data: true,
          summary_cn: true,
        },
      },
    },
  });
  if (!receipt || !["NEEDS_REVIEW", "DRAFT"].includes(receipt.receipt_sttus_code)) {
    throw new BatchPlanningError(
      "RECEIPT_NOT_ANALYZABLE",
      "병합 가능한 receipt를 찾을 수 없습니다.",
      404,
    );
  }
  if (receipt.batches.length === 0) {
    return { merged: false, reason: "NO_ANALYSIS_BATCH" };
  }
  if (receipt.batches.some((batch) => batch.batch_sttus_code === "FAILED")) {
    await tx.tbSpImplReceipt.update({
      where: { receipt_id: receiptId },
      data: { review_sttus_code: "ANALYSIS_PARTIAL_FAILED", mdfcn_dt: new Date() },
    });
    return { merged: false, reason: "FAILED_BATCH" };
  }
  if (receipt.batches.some((batch) =>
    !["COMPLETED"].includes(batch.batch_sttus_code),
  )) {
    await tx.tbSpImplReceipt.update({
      where: { receipt_id: receiptId },
      data: { review_sttus_code: "ANALYZING", mdfcn_dt: new Date() },
    });
    return { merged: false, reason: "BATCHES_PENDING" };
  }
  if (receipt.items.some((item) =>
    !["PENDING", "STALE_SPEC", "BATCH_CONFLICT"].includes(item.item_sttus_code),
  )) {
    throw new BatchPlanningError(
      "DECISION_ALREADY_STARTED",
      "사람의 결정이 시작된 receipt는 배치 결과로 덮어쓸 수 없습니다.",
    );
  }

  const targetMap = new Map<string, BatchTargetRef>();
  const grouped = new Map<string, Array<{
    batchId: string;
    batchName: string;
    proposal: ValidatedBatchResult["proposals"][number];
  }>>();
  const summaries: string[] = [];
  for (const batch of receipt.batches) {
    for (const target of parseTargetRefs(batch.target_refs_data)) {
      targetMap.set(targetKey(target), target);
    }
    const parsed = batchAnalysisResultSchema.safeParse(batch.analysis_result_data);
    if (!parsed.success) {
      return markReconciliationBatchFailed(
        tx,
        batch.batch_id,
        "저장된 배치 분석 결과를 다시 검증할 수 없습니다.",
      );
    }
    if (parsed.data.summary) summaries.push(parsed.data.summary);
    for (const proposal of parsed.data.proposals) {
      const key = proposalKey(proposal);
      const current = grouped.get(key) ?? [];
      current.push({
        batchId: batch.batch_id,
        batchName: batch.scope_nm,
        proposal,
      });
      grouped.set(key, current);
    }
  }

  await tx.tbSpReconcileItem.deleteMany({ where: { receipt_id: receiptId } });
  const riskSummary: Record<string, number> = {
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
    CRITICAL: 0,
  };
  let conflictCount = 0;
  const selectedTargets: Array<{ targetRefType: string; targetRefId: string }> = [];
  for (const [key, origins] of grouped) {
    const mergedProposal = mergeBatchProposalOrigins(origins);
    const first = mergedProposal.first;
    const target = targetMap.get(key);
    if (!target) {
      throw new BatchPlanningError(
        "BATCH_TARGET_MISSING",
        `병합 대상의 설계 snapshot을 찾을 수 없습니다: ${key}`,
      );
    }
    const conflict = mergedProposal.conflict;
    if (conflict) conflictCount += 1;
    const risk = mergedProposal.risk;
    const confidence = mergedProposal.confidence;
    riskSummary[risk] = (riskSummary[risk] ?? 0) + 1;
    selectedTargets.push({
      targetRefType: first.targetRefType,
      targetRefId: first.targetRefId,
    });
    await tx.tbSpReconcileItem.create({
      data: {
        receipt_id: receiptId,
        classification_code: first.classification,
        target_ref_ty_code: first.targetRefType,
        target_ref_id: first.targetRefId,
        target_field_nm: first.targetField,
        target_hierarchy_data: target.hierarchy as Prisma.InputJsonValue,
        source_evidence_data: {
          batchOrigins: origins.map((origin) => ({
            batchId: origin.batchId,
            batchName: origin.batchName,
            evidence: origin.proposal.sourceEvidence,
          })),
        } as unknown as Prisma.InputJsonValue,
        source_fact_cn: mergedProposal.sourceFact,
        inferred_impact_cn: mergedProposal.inferredImpact,
        before_value_cn: first.beforeValue,
        proposed_value_cn: first.proposedValue,
        before_hash: first.beforeHash.toLowerCase(),
        risk_code: risk,
        confidence_code: confidence,
        item_sttus_code: conflict ? "BATCH_CONFLICT" : "PENDING",
        merge_conflict_data: conflict
          ? ({
              type: "BATCH_PROPOSAL_CONFLICT",
              candidates: origins.map((origin) => ({
                batchId: origin.batchId,
                batchName: origin.batchName,
                proposedValue: origin.proposal.proposedValue,
                sourceFact: origin.proposal.sourceFact,
                inferredImpact: origin.proposal.inferredImpact ?? null,
                sourceEvidence: origin.proposal.sourceEvidence,
                classification: origin.proposal.classification,
                risk: origin.proposal.risk,
                confidence: origin.proposal.confidence,
                beforeValue: origin.proposal.beforeValue,
                beforeHash: origin.proposal.beforeHash,
              })),
            } as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        batch_origin_data: {
          batchIds: origins.map((origin) => origin.batchId),
        },
      },
    });
  }
  await tx.tbSpImplReceipt.update({
    where: { receipt_id: receiptId },
    data: {
      summary_cn: summaries.length > 0
        ? summaries.map((summary) => `- ${summary}`).join("\n")
        : "배치 분석 결과 스펙 변경 후보가 없습니다.",
      selected_target_data: selectedTargets,
      risk_summary_data: riskSummary,
      review_sttus_code: conflictCount > 0 ? "BATCH_CONFLICT" : "NEEDS_REVIEW",
      analysis_version: "spec-reconcile/auto-batch-v1",
      mdfcn_dt: new Date(),
    },
  });
  return {
    merged: true,
    itemCount: grouped.size,
    conflictCount,
  };
}

export async function resolveBatchConflict(
  tx: Prisma.TransactionClient,
  input: {
    receiptId: string;
    itemId: string;
    batchId: string;
  },
) {
  // 서로 다른 충돌 항목을 동시에 해결할 때 remaining=0 판정이 유실되지 않게 직렬화한다.
  await lockReceipt(tx, input.receiptId);
  const item = await tx.tbSpReconcileItem.findFirst({
    where: {
      item_id: input.itemId,
      receipt_id: input.receiptId,
      item_sttus_code: "BATCH_CONFLICT",
    },
    select: { merge_conflict_data: true },
  });
  if (!item) {
    throw new BatchPlanningError(
      "BATCH_CONFLICT_NOT_FOUND",
      "해결할 배치 충돌 항목을 찾을 수 없습니다.",
      404,
    );
  }
  const conflict = asRecord(item.merge_conflict_data);
  const candidates = Array.isArray(conflict?.candidates)
    ? conflict.candidates.map(asRecord).filter(
        (candidate): candidate is Record<string, unknown> => Boolean(candidate),
      )
    : [];
  const selected = candidates.find(
    (candidate) => stringValue(candidate.batchId) === input.batchId,
  );
  if (!selected) {
    throw new BatchPlanningError(
      "BATCH_CONFLICT_CANDIDATE_NOT_FOUND",
      "선택한 배치 제안을 찾을 수 없습니다.",
      400,
    );
  }
  const proposedValue = stringValue(selected.proposedValue);
  const sourceFact = stringValue(selected.sourceFact);
  if (!proposedValue || !sourceFact) {
    throw new BatchPlanningError(
      "INVALID_BATCH_CONFLICT_CANDIDATE",
      "선택한 배치 제안의 내용이 올바르지 않습니다.",
      400,
    );
  }
  await tx.tbSpReconcileItem.update({
    where: { item_id: input.itemId },
    data: {
      proposed_value_cn: proposedValue,
      source_fact_cn: sourceFact,
      inferred_impact_cn: stringValue(selected.inferredImpact),
      classification_code: stringValue(selected.classification) ?? "SPEC_CHANGE",
      risk_code: stringValue(selected.risk) ?? "MEDIUM",
      confidence_code: stringValue(selected.confidence) ?? "MEDIUM",
      source_evidence_data: {
        selectedBatchId: input.batchId,
        evidence: selected.sourceEvidence ?? {},
        conflictCandidates: candidates.map((candidate) => ({
          batchId: candidate.batchId,
          batchName: candidate.batchName,
        })),
      } as unknown as Prisma.InputJsonValue,
      item_sttus_code: "PENDING",
      merge_conflict_data: Prisma.JsonNull,
      mdfcn_dt: new Date(),
    },
  });
  const remaining = await tx.tbSpReconcileItem.count({
    where: {
      receipt_id: input.receiptId,
      item_sttus_code: "BATCH_CONFLICT",
    },
  });
  if (remaining === 0) {
    await tx.tbSpImplReceipt.update({
      where: { receipt_id: input.receiptId },
      data: { review_sttus_code: "NEEDS_REVIEW", mdfcn_dt: new Date() },
    });
  }
  return { itemId: input.itemId, selectedBatchId: input.batchId, remaining };
}

function parseJsonResult(raw: string): unknown {
  const trimmed = raw.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

async function lockReceipt(
  tx: Prisma.TransactionClient,
  receiptId: string,
) {
  await tx.$queryRaw(Prisma.sql`
    SELECT receipt_id
    FROM tb_sp_impl_receipt
    WHERE receipt_id = ${receiptId}
    FOR UPDATE
  `);
}

function parseTargetRefs(value: Prisma.JsonValue): BatchTargetRef[] {
  return Array.isArray(value) ? value as unknown as BatchTargetRef[] : [];
}

function targetKey(target: BatchTargetRef) {
  return `${target.targetRefType}:${target.targetRefId}:${target.targetField}`;
}

function proposalKey(proposal: {
  targetRefType: string;
  targetRefId: string;
  targetField: string;
}) {
  return `${proposal.targetRefType}:${proposal.targetRefId}:${proposal.targetField}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string =>
        typeof item === "string" && item.trim().length > 0)
    : [];
}

function evidencePaths(value: unknown) {
  const paths = new Set<string>();
  const visit = (current: unknown) => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    const record = asRecord(current);
    if (!record) return;
    const path = stringValue(record.path);
    if (path) paths.add(path);
    for (const [key, child] of Object.entries(record)) {
      if (key === "files") {
        for (const file of stringArray(child)) paths.add(file);
      }
      visit(child);
    }
  };
  visit(value);
  return Array.from(paths);
}
