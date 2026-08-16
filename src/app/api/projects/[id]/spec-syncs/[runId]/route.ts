/** 동기화 실행의 두 판정 축, 근거와 결정 상태를 조회한다. */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { requirePermission } from "@/lib/requirePermission";
import { specSyncApiError } from "@/lib/spec-sync/api";
import { loadDesignSnapshot } from "@/lib/spec-sync/designContext";

type RouteParams = { params: Promise<{ id: string; runId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, runId } = await params;
  const gate = await requirePermission(request, projectId, "specSync.read");
  if (gate instanceof Response) return gate;

  try {
    const run = await prisma.tbSpSyncRun.findFirst({
      where: { sync_run_id: runId, prjct_id: projectId },
      include: {
        items: { orderBy: [{ finding_ty_code: "asc" }, { creat_dt: "asc" }] },
      },
    });
    if (!run) return apiError("NOT_FOUND", "동기화 실행을 찾을 수 없습니다.", 404);

    let currentValues = new Map<string, string>();
    if (
      run.unit_work_id &&
      run.items.some((item) => item.item_sttus_code === "DESIGN_CHANGED")
    ) {
      try {
        const { snapshot } = await loadDesignSnapshot({
          projectId,
          unitWorkRef: run.unit_work_id,
        });
        currentValues = new Map(
          snapshot.targets.map((target) => [
            `${target.targetType}:${target.targetId}:${target.targetField}`,
            target.value,
          ]),
        );
      } catch {
        // 대상 삭제도 DESIGN_CHANGED의 한 형태다. 상세 자체는 계속 보여준다.
      }
    }

    return apiSuccess({
      syncRunId: run.sync_run_id,
      projectId: run.prjct_id,
      unitWorkId: run.unit_work_id,
      unitWorkDisplayId: run.unit_work_display_id,
      unitWorkName: run.unit_work_nm,
      mode: run.sync_mode_code,
      status: run.sync_sttus_code,
      designSnapshotHash: run.design_snapshot_hash,
      sourceScope: run.source_scope_data,
      summary: run.analysis_summary_data,
      implementationVerdict: run.implementation_verdict_code,
      designCoverageVerdict: run.design_coverage_verdict_code,
      failure: run.failure_cn,
      requesterId: run.req_mber_id,
      createdAt: run.creat_dt.toISOString(),
      analyzedAt: run.analyzed_dt?.toISOString() ?? null,
      completedAt: run.compl_dt?.toISOString() ?? null,
      items: run.items.map((item) => ({
        syncItemId: item.sync_item_id,
        findingType: item.finding_ty_code,
        resultCode: item.result_code,
        importance: item.importance_code,
        targetType: item.target_ref_ty_code,
        targetId: item.target_ref_id,
        targetField: item.target_field_nm,
        targetDisplayId: item.target_display_id,
        targetName: item.target_nm,
        designStatement: item.design_statement_cn,
        sourceFact: item.source_fact_cn,
        reason: item.reason_cn,
        evidence: item.source_evidence_data,
        confidence: item.confidence_code,
        beforeValue: item.before_value_cn,
        currentValue:
          item.item_sttus_code === "DESIGN_CHANGED" &&
          item.target_ref_ty_code &&
          item.target_ref_id &&
          item.target_field_nm
            ? currentValues.get(
                `${item.target_ref_ty_code}:${item.target_ref_id}:${item.target_field_nm}`,
              ) ?? null
            : null,
        proposedValue: item.proposed_value_cn,
        status: item.item_sttus_code,
        decision: item.decision_code,
        decisionReason: item.decision_rsn_cn,
        decisionMemberId: item.decision_mber_id,
        decisionAt: item.decision_dt?.toISOString() ?? null,
        designChangeId: item.design_change_id,
      })),
    });
  } catch (error) {
    return specSyncApiError(error);
  }
}
