/**
 * CI/merge/deploy 전 정합성 경고 게이트.
 *
 * 초기 정책은 차단이 아니라 판정 결과 제공이다. 호출자가 allowed=false를 경고 또는
 * 차단으로 사용할지는 프로젝트 CI 정책에서 결정한다.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { requirePermission } from "@/lib/requirePermission";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(
    request,
    projectId,
    "specReconcile.read",
  );
  if (gate instanceof Response) return gate;

  const url = new URL(request.url);
  const repoKey = url.searchParams.get("repoKey")?.trim();
  const branchName = url.searchParams.get("branch")?.trim();
  const headCheckpoint = url.searchParams.get("head")?.trim() || null;
  if (!repoKey || !branchName) {
    return apiError(
      "VALIDATION_ERROR",
      "repoKey와 branch query가 필요합니다.",
      400,
    );
  }

  const baseline = await prisma.tbSpSourceBaseline.findUnique({
    where: {
      prjct_id_repo_key_branch_nm: {
        prjct_id: projectId,
        repo_key: repoKey,
        branch_nm: branchName,
      },
    },
    select: {
      baseline_id: true,
      checkpoint_ty_code: true,
      last_reconciled_commit_sha: true,
      last_reconciled_manifest_hash: true,
      checkpoint_version_no: true,
      reconciled_dt: true,
    },
  });
  const configs = await prisma.tbPjProjectConfig.findMany({
    where: {
      prjct_id: projectId,
      config_key: {
        in: [
          "SPEC_RECONCILE_GATE_POLICY",
          "SPEC_RECONCILE_BLOCK_RISKS",
        ],
      },
    },
    select: { config_key: true, config_value: true },
  });
  const config = new Map(
    configs.map((item) => [item.config_key, item.config_value]),
  );
  const policy =
    config.get("SPEC_RECONCILE_GATE_POLICY") === "BLOCK"
      ? "BLOCK"
      : "WARN";
  const blockRisks = new Set(
    (config.get("SPEC_RECONCILE_BLOCK_RISKS") ?? "HIGH,CRITICAL")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
  );
  if (!baseline) {
    return apiSuccess({
      allowed: policy === "WARN",
      clean: false,
      policy,
      reasons: ["SOURCE_BASELINE_MISSING"],
      baseline: null,
      unresolved: [],
    });
  }

  const unresolved = await prisma.tbSpImplReceipt.findMany({
    where: {
      baseline_id: baseline.baseline_id,
      receipt_sttus_code: {
        in: ["DRAFT", "NEEDS_REVIEW", "STALE_BASELINE"],
      },
    },
    orderBy: { creat_dt: "asc" },
    select: {
      receipt_id: true,
      receipt_sttus_code: true,
      head_checkpoint_val: true,
      creat_dt: true,
      items: {
        where: {
          item_sttus_code: {
            notIn: ["APPLIED", "NO_SPEC_CHANGE", "RESOLVED", "ROLLED_BACK"],
          },
        },
        select: {
          risk_code: true,
        },
      },
    },
  });
  const checkpoint =
    baseline.checkpoint_ty_code === "GIT_COMMIT"
      ? baseline.last_reconciled_commit_sha
      : baseline.last_reconciled_manifest_hash?.trim() ?? null;
  const reasons: string[] = [];
  if (unresolved.length > 0) reasons.push("UNRESOLVED_RECEIPTS");
  if (unresolved.some((receipt) => receipt.receipt_sttus_code === "DRAFT")) {
    reasons.push("UNCOMMITTED_DRAFT");
  }
  if (
    unresolved.some((receipt) =>
      receipt.items.some((item) =>
        blockRisks.has(item.risk_code),
      ),
    )
  ) {
    reasons.push("HIGH_RISK_UNRESOLVED");
  }
  if (headCheckpoint && checkpoint !== headCheckpoint) {
    reasons.push("HEAD_NOT_RECONCILED");
  }

  return apiSuccess({
    allowed: reasons.length === 0 || policy === "WARN",
    clean: reasons.length === 0,
    policy,
    blockRisks: Array.from(blockRisks),
    reasons,
    baseline: {
      checkpointType: baseline.checkpoint_ty_code,
      checkpoint,
      version: baseline.checkpoint_version_no,
      reconciledAt: baseline.reconciled_dt?.toISOString() ?? null,
    },
    unresolved: unresolved.map((receipt) => ({
      receiptId: receipt.receipt_id,
      status: receipt.receipt_sttus_code,
      headCheckpoint: receipt.head_checkpoint_val,
      createdAt: receipt.creat_dt.toISOString(),
      unresolvedItemCount: receipt.items.length,
      maxRisk: maxRisk(receipt.items.map((item) => item.risk_code)),
      reviewUrl:
        `/projects/${projectId}/spec-reconciliations/${receipt.receipt_id}`,
    })),
  });
}

function maxRisk(risks: string[]) {
  const order = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  return risks.reduce(
    (max, risk) =>
      order.indexOf(risk) > order.indexOf(max) ? risk : max,
    "LOW",
  );
}
