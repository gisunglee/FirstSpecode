/**
 * SPEC_RECONCILIATION AI 태스크의 구조화 결과를 receipt 후보로 반영한다.
 *
 * AI 출력은 그대로 믿지 않고 대상 소속, 허용 필드, before 원문/hash를 서버에서 다시
 * 검증한다. 실패 결과는 스펙을 건드리지 않고 receipt에 분석 실패 상태만 남긴다.
 */

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { hashOf } from "@/lib/impl-request/diff/normalizer";
import { reconcileProposalSchema } from "./contracts";
import { getTargetSnapshot } from "./targetRegistry";

const analysisResultSchema = z.object({
  summary: z.string().trim().max(4_000).optional(),
  analysisVersion: z.string().trim().max(50).optional(),
  proposals: z.array(reconcileProposalSchema).max(500),
});

export async function applyReconciliationAnalysisResult(
  tx: Prisma.TransactionClient,
  receiptId: string,
  rawResult: string,
) {
  const receipt = await tx.tbSpImplReceipt.findUnique({
    where: { receipt_id: receiptId },
    select: {
      receipt_id: true,
      prjct_id: true,
      receipt_sttus_code: true,
      baseline_version_no: true,
      sourceBaseline: {
        select: { checkpoint_version_no: true },
      },
      items: {
        select: { item_id: true, item_sttus_code: true },
      },
    },
  });
  if (!receipt || receipt.receipt_sttus_code !== "NEEDS_REVIEW") {
    return markAnalysisFailed(
      tx,
      receiptId,
      "분석 대상 receipt가 없거나 검토 가능한 상태가 아닙니다.",
    );
  }
  if (
    receipt.baseline_version_no !==
    receipt.sourceBaseline.checkpoint_version_no
  ) {
    await tx.tbSpImplReceipt.update({
      where: { receipt_id: receiptId },
      data: {
        receipt_sttus_code: "STALE_BASELINE",
        review_sttus_code: "STALE_BASELINE",
        mdfcn_dt: new Date(),
      },
    });
    return { applied: false, reason: "STALE_BASELINE" };
  }
  if (
    receipt.items.some(
      (item) => !["PENDING", "STALE_SPEC"].includes(item.item_sttus_code),
    )
  ) {
    return markAnalysisFailed(
      tx,
      receiptId,
      "이미 사람이 결정한 항목이 있어 AI 재분석 결과로 덮어쓸 수 없습니다.",
    );
  }

  const parsedJson = parseJsonResult(rawResult);
  const parsed = analysisResultSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return markAnalysisFailed(
      tx,
      receiptId,
      `AI 분석 JSON 검증 실패: ${parsed.error.issues[0]?.message ?? "형식 오류"}`,
    );
  }

  const keys = new Set<string>();
  const validated = [];
  for (const proposal of parsed.data.proposals) {
    const key =
      `${proposal.targetRefType}:${proposal.targetRefId}:${proposal.targetField}`;
    if (keys.has(key)) {
      return markAnalysisFailed(tx, receiptId, `중복 제안 대상: ${key}`);
    }
    keys.add(key);

    const target = await getTargetSnapshot(
      tx,
      receipt.prjct_id,
      proposal.targetRefType,
      proposal.targetRefId,
      proposal.targetField,
    );
    if (!target) {
      return markAnalysisFailed(tx, receiptId, `대상 스펙을 찾을 수 없음: ${key}`);
    }
    if (
      target.value !== proposal.beforeValue ||
      hashOf(target.value).hash !== proposal.beforeHash.toLowerCase()
    ) {
      return markAnalysisFailed(
        tx,
        receiptId,
        `분석 중 스펙이 변경됨: ${key}`,
      );
    }
    if (hashOf(proposal.proposedValue).hash === proposal.beforeHash.toLowerCase()) {
      return markAnalysisFailed(tx, receiptId, `변경 내용이 없는 제안: ${key}`);
    }
    validated.push({ proposal, target });
  }

  await tx.tbSpReconcileItem.deleteMany({
    where: { receipt_id: receiptId },
  });
  for (const { proposal, target } of validated) {
    await tx.tbSpReconcileItem.create({
      data: {
        receipt_id: receiptId,
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
      },
    });
  }

  const riskSummary = parsed.data.proposals.reduce<Record<string, number>>(
    (summary, proposal) => {
      summary[proposal.risk] = (summary[proposal.risk] ?? 0) + 1;
      return summary;
    },
    { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
  );
  await tx.tbSpImplReceipt.update({
    where: { receipt_id: receiptId },
    data: {
      summary_cn: parsed.data.summary || null,
      analysis_version:
        parsed.data.analysisVersion ?? "spec-reconcile/server-worker-v1",
      selected_target_data: parsed.data.proposals.map((proposal) => ({
        targetRefType: proposal.targetRefType,
        targetRefId: proposal.targetRefId,
      })),
      risk_summary_data: riskSummary,
      review_sttus_code: "NEEDS_REVIEW",
      mdfcn_dt: new Date(),
    },
  });
  return { applied: true, itemCount: validated.length };
}

function parseJsonResult(raw: string): unknown {
  const trimmed = raw.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(withoutFence);
  } catch {
    return null;
  }
}

async function markAnalysisFailed(
  tx: Prisma.TransactionClient,
  receiptId: string,
  reason: string,
) {
  await tx.tbSpImplReceipt.updateMany({
    where: { receipt_id: receiptId },
    data: {
      review_sttus_code: "ANALYSIS_FAILED",
      evidence_verify_data: {
        analysisFailure: reason,
      },
      mdfcn_dt: new Date(),
    },
  });
  return { applied: false, reason };
}
