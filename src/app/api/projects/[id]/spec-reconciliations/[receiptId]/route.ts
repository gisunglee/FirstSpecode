/**
 * GET /api/projects/[id]/spec-reconciliations/[receiptId]
 * 스펙 변경 접수와 항목의 전체 검토 정보를 반환한다. (FID-00212)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { requirePermission } from "@/lib/requirePermission";

type RouteParams = {
  params: Promise<{ id: string; receiptId: string }>;
};

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, receiptId } = await params;
  const gate = await requirePermission(request, projectId, "specReconcile.read");
  if (gate instanceof Response) return gate;

  try {
    const receipt = await prisma.tbSpImplReceipt.findFirst({
      where: { receipt_id: receiptId, prjct_id: projectId },
      select: {
        receipt_id:           true,
        origin_ty_code:       true,
        ai_task_id:           true,
        baseline_version_no:  true,
        base_checkpoint_val:  true,
        head_checkpoint_val:  true,
        checkpoint_ty_code:   true,
        source_evidence_data: true,
        evidence_trust_code:  true,
        evidence_verify_code: true,
        ancestry_verify_yn:   true,
        diff_hash:             true,
        evidence_verify_data: true,
        override_rsn_cn:      true,
        pr_url:                true,
        manifest_data:        true,
        selected_target_data: true,
        analysis_scope_data:  true,
        risk_summary_data:    true,
        review_sttus_code:    true,
        analysis_version:     true,
        head_stable_yn:       true,
        summary_cn:           true,
        receipt_sttus_code:   true,
        submit_mber_id:       true,
        close_mber_id:        true,
        creat_dt:             true,
        close_dt:             true,
        sourceBaseline: {
          select: {
            checkpoint_version_no: true,
          },
        },
        items: {
          orderBy: { creat_dt: "asc" },
          select: {
            item_id:                true,
            classification_code:    true,
            target_ref_ty_code:     true,
            target_ref_id:          true,
            target_field_nm:        true,
            target_hierarchy_data:  true,
            source_evidence_data:   true,
            source_fact_cn:         true,
            inferred_impact_cn:     true,
            before_value_cn:        true,
            proposed_value_cn:      true,
            before_hash:            true,
            risk_code:              true,
            confidence_code:        true,
            item_sttus_code:        true,
            decision_code:          true,
            decision_rsn_cn:        true,
            decision_mber_id:       true,
            decision_dt:            true,
            design_change_id:       true,
            resolution_evidence_data: true,
            exception_expire_dt:      true,
            exception_owner_mber_id:  true,
            followup_task_id:          true,
            review_request_id:         true,
            merge_preview_cn:          true,
            merge_latest_hash:         true,
            merge_conflict_data:       true,
            batch_origin_data:         true,
            resolved_dt:               true,
          },
        },
        batches: {
          orderBy: { batch_no: "asc" },
          select: {
            batch_id: true,
            batch_no: true,
            batch_key: true,
            scope_ty_code: true,
            scope_ref_id: true,
            scope_nm: true,
            source_paths_data: true,
            target_refs_data: true,
            metrics_data: true,
            batch_sttus_code: true,
            ai_task_id: true,
            summary_cn: true,
            failure_cn: true,
            retry_cnt: true,
            creat_dt: true,
            compl_dt: true,
          },
        },
      },
    });

    if (!receipt) {
      return apiError("NOT_FOUND", "스펙 변경 접수를 찾을 수 없습니다.", 404);
    }

    const memberIds = Array.from(new Set(
      [receipt.submit_mber_id, receipt.close_mber_id, ...receipt.items.map((item) => item.decision_mber_id)]
        .filter((id): id is string => Boolean(id)),
    ));
    const members = memberIds.length === 0
      ? []
      : await prisma.tbCmMember.findMany({
          where: { mber_id: { in: memberIds } },
          select: { mber_id: true, mber_nm: true, email_addr: true },
        });
    const names = new Map(
      members.map((member) => [
        member.mber_id,
        member.mber_nm || member.email_addr || member.mber_id,
      ]),
    );

    return apiSuccess({
      receiptId:              receipt.receipt_id,
      originType:             receipt.origin_ty_code,
      aiTaskId:               receipt.ai_task_id,
      status:                 receipt.receipt_sttus_code,
      summary:                receipt.summary_cn ?? "",
      checkpointType:         receipt.checkpoint_ty_code,
      baseCheckpoint:         receipt.base_checkpoint_val,
      headCheckpoint:         receipt.head_checkpoint_val,
      submittedBaselineVersion: receipt.baseline_version_no,
      currentBaselineVersion: receipt.sourceBaseline.checkpoint_version_no,
      sourceEvidence:         receipt.source_evidence_data,
      evidenceTrust:          receipt.evidence_trust_code,
      evidenceVerify:         receipt.evidence_verify_code,
      ancestryVerified:
        receipt.ancestry_verify_yn == null
          ? null
          : receipt.ancestry_verify_yn === "Y",
      diffHash:               receipt.diff_hash?.trim() ?? null,
      evidenceVerifyData:     receipt.evidence_verify_data,
      overrideReason:         receipt.override_rsn_cn,
      prUrl:                  receipt.pr_url,
      manifest:               receipt.manifest_data,
      selectedTargets:        receipt.selected_target_data,
      analysisScope:          receipt.analysis_scope_data,
      riskSummary:            receipt.risk_summary_data,
      reviewStatus:           receipt.review_sttus_code,
      analysisVersion:        receipt.analysis_version,
      headStable:             receipt.head_stable_yn === "Y",
      submitMemberName:       receipt.submit_mber_id
        ? names.get(receipt.submit_mber_id) ?? receipt.submit_mber_id
        : "시스템",
      closeMemberName:        receipt.close_mber_id
        ? names.get(receipt.close_mber_id) ?? receipt.close_mber_id
        : null,
      createdAt:              receipt.creat_dt.toISOString(),
      closedAt:               receipt.close_dt?.toISOString() ?? null,
      canApply:               gate.role === "OWNER" ||
        gate.role === "ADMIN" ||
        gate.job === "PM" ||
        gate.job === "PL",
      canOverride:            gate.role === "OWNER" || gate.role === "ADMIN",
      batches: receipt.batches.map((batch) => ({
        batchId: batch.batch_id,
        batchNo: batch.batch_no,
        batchKey: batch.batch_key,
        scopeType: batch.scope_ty_code,
        scopeRefId: batch.scope_ref_id,
        scopeName: batch.scope_nm,
        sourcePaths: batch.source_paths_data,
        targetCount: Array.isArray(batch.target_refs_data)
          ? batch.target_refs_data.length
          : 0,
        metrics: batch.metrics_data,
        status: batch.batch_sttus_code,
        taskId: batch.ai_task_id,
        summary: batch.summary_cn,
        failure: batch.failure_cn,
        retryCount: batch.retry_cnt,
        createdAt: batch.creat_dt.toISOString(),
        completedAt: batch.compl_dt?.toISOString() ?? null,
      })),
      items: receipt.items.map((item) => ({
        itemId:          item.item_id,
        classification:  item.classification_code,
        targetRefType:   item.target_ref_ty_code,
        targetRefId:     item.target_ref_id,
        targetField:     item.target_field_nm,
        targetHierarchy: item.target_hierarchy_data,
        sourceEvidence:  item.source_evidence_data,
        sourceFact:      item.source_fact_cn,
        inferredImpact:  item.inferred_impact_cn,
        beforeValue:     item.before_value_cn,
        proposedValue:   item.proposed_value_cn,
        beforeHash:      item.before_hash.trim(),
        risk:            item.risk_code,
        confidence:      item.confidence_code,
        status:          item.item_sttus_code,
        decision:        item.decision_code,
        decisionReason:  item.decision_rsn_cn,
        decisionMemberName: item.decision_mber_id
          ? names.get(item.decision_mber_id) ?? item.decision_mber_id
          : null,
        decidedAt:       item.decision_dt?.toISOString() ?? null,
        designChangeId:  item.design_change_id,
        resolutionEvidence: item.resolution_evidence_data,
        exceptionExpiresAt: item.exception_expire_dt?.toISOString() ?? null,
        exceptionOwnerMemberId: item.exception_owner_mber_id,
        followupTaskId: item.followup_task_id,
        reviewRequestId: item.review_request_id,
        mergePreview: item.merge_preview_cn,
        mergeLatestHash: item.merge_latest_hash?.trim() ?? null,
        mergeConflicts: item.merge_conflict_data,
        batchOrigin: item.batch_origin_data,
        resolvedAt: item.resolved_dt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    console.error(
      `[GET /api/projects/${projectId}/spec-reconciliations/${receiptId}] 오류:`,
      error,
    );
    return apiError("DB_ERROR", "스펙 변경 접수를 조회하지 못했습니다.", 500);
  }
}
