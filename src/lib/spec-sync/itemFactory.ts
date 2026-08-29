/** 검증된 두 판정 축을 항목별 영속 데이터로 변환한다. */

import { Prisma } from "@prisma/client";
import type { DesignSnapshot } from "./contracts";
import type { DerivedProposal, validateSyncResult } from "./resultValidator";

export function buildItemData(
  runId: string,
  analysis: ReturnType<typeof validateSyncResult>["analysis"],
  proposals: Map<string, DerivedProposal>,
  snapshot: DesignSnapshot,
): Prisma.TbSpSyncItemCreateManyInput[] {
  const targets = new Map(
    snapshot.targets.map((target) => [targetKey(target), target]),
  );
  const items: Prisma.TbSpSyncItemCreateManyInput[] = [];

  for (const finding of analysis.implementation.issues) {
    const key = targetKey(finding);
    const target = targets.get(key)!;
    const proposal = proposals.get(`IMPLEMENTATION:${key}`);
    items.push({
      sync_run_id: runId,
      finding_ty_code: "IMPLEMENTATION",
      result_code: finding.resultCode,
      importance_code: finding.resultCode === "UNKNOWN" ? "NORMAL" : "HIGH",
      target_ref_ty_code: finding.targetType,
      target_ref_id: finding.targetId,
      target_field_nm: finding.targetField,
      target_display_id: target.displayId,
      target_nm: target.name,
      design_statement_cn: finding.designStatement,
      source_fact_cn: finding.sourceFact,
      reason_cn: finding.reason,
      source_evidence_data: finding.evidence as Prisma.InputJsonValue,
      confidence_code: finding.confidence,
      before_value_cn: proposal?.beforeValue ?? null,
      before_hash: proposal?.beforeHash ?? null,
      proposed_value_cn: proposal?.proposedValue ?? null,
      item_sttus_code: "PENDING",
    });
  }

  for (const finding of analysis.designCoverage.issues) {
    const semanticKey = coverageKey(finding);
    const proposal = proposals.get(`COVERAGE:${semanticKey}`);
    const target =
      finding.targetType && finding.targetId && finding.targetField
        ? targets.get(
            targetKey({
              targetType: finding.targetType,
              targetId: finding.targetId,
              targetField: finding.targetField,
            }),
          )
        : null;
    items.push({
      sync_run_id: runId,
      finding_ty_code: "DESIGN_COVERAGE",
      result_code: finding.resultCode,
      importance_code: finding.importance,
      target_ref_ty_code: finding.targetType,
      target_ref_id: finding.targetId,
      target_field_nm: finding.targetField,
      target_display_id: target?.displayId ?? null,
      target_nm: target?.name ?? null,
      design_statement_cn: finding.designStatement,
      source_fact_cn: finding.sourceFact,
      reason_cn: finding.reason,
      source_evidence_data: finding.evidence as Prisma.InputJsonValue,
      confidence_code: finding.confidence,
      before_value_cn: proposal?.beforeValue ?? null,
      before_hash: proposal?.beforeHash ?? null,
      proposed_value_cn: proposal?.proposedValue ?? null,
      item_sttus_code: "PENDING",
    });
  }

  return items;
}

function targetKey(input: {
  targetType: string;
  targetId: string;
  targetField: string;
}) {
  return `${input.targetType}:${input.targetId}:${input.targetField}`;
}

function coverageKey(finding: {
  resultCode: string;
  targetType: string | null;
  targetId: string | null;
  sourceFact: string;
}) {
  return [
    finding.resultCode,
    finding.targetType ?? "NONE",
    finding.targetId ?? "NONE",
    finding.sourceFact.trim(),
  ].join(":");
}
