/**
 * GET /api/worker/spec-reconciliations/baseline
 *
 * /sync-specode가 로컬 변경을 수집하기 전에 서버의 공통 비교 기준점을 조회한다.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { requireWorkerAuth } from "../../_lib/auth";

export async function GET(request: NextRequest) {
  const auth = await requireWorkerAuth(request);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const repoKey = url.searchParams.get("repoKey")?.trim();
  const branchName = url.searchParams.get("branchName")?.trim();
  if (!repoKey || !branchName) {
    return apiError(
      "VALIDATION_ERROR",
      "repoKey와 branchName이 필요합니다.",
      400,
    );
  }

  const baseline = await prisma.tbSpSourceBaseline.findUnique({
    where: {
      prjct_id_repo_key_branch_nm: {
        prjct_id: auth.prjctId,
        repo_key: repoKey,
        branch_nm: branchName,
      },
    },
  });
  if (!baseline || baseline.use_yn !== "Y") {
    return apiError(
      "SOURCE_BASELINE_REQUIRED",
      "이 저장소·브랜치의 source baseline이 없습니다. SPECODE 웹에서 최초 기준선을 승인해 주세요.",
      404,
    );
  }

  return apiSuccess({
    projectId: auth.prjctId,
    projectName: auth.prjctNm,
    baselineId: baseline.baseline_id,
    repoKey: baseline.repo_key,
    repoProvider: baseline.repo_provider_code,
    branchName: baseline.branch_nm,
    checkpointType: baseline.checkpoint_ty_code,
    checkpoint:
      baseline.checkpoint_ty_code === "GIT_COMMIT"
        ? baseline.last_reconciled_commit_sha
        : baseline.last_reconciled_manifest_hash?.trim(),
    checkpointVersion: baseline.checkpoint_version_no,
    historyAudit: baseline.history_audit_code,
    reconciledAt: baseline.reconciled_dt?.toISOString() ?? null,
  });
}

