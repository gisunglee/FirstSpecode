/**
 * 프로젝트 source baseline 목록 조회 및 최초 승인.
 *
 * 후속 변경(Type B)은 반드시 여기 저장된 프로젝트·저장소·브랜치 기준점에서 시작한다.
 * 개별 receipt의 마지막 값을 추측해서 기준선으로 사용하지 않는다.
 */

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { requirePermission } from "@/lib/requirePermission";
import { isValidCheckpoint } from "@/lib/spec-reconciliation/contracts";
import {
  SourceProviderError,
  verifyConfiguredProviderDiff,
} from "@/lib/spec-reconciliation/sourceProvider";

type RouteParams = { params: Promise<{ id: string }> };

const createSchema = z.object({
  repoKey: z.string().trim().min(1).max(200),
  repoProvider: z
    .enum(["GITHUB", "GITLAB", "LOCAL", "NONE", "ETC"])
    .default("LOCAL"),
  branchName: z.string().trim().min(1).max(200),
  checkpointType: z.enum(["GIT_COMMIT", "SOURCE_MANIFEST"]),
  checkpoint: z.string().trim().min(7).max(128),
  historyAudit: z
    .enum(["NOT_AUDITED", "VERIFIED_FROM_POINT", "FULLY_AUDITED"])
    .default("NOT_AUDITED"),
  approvalReason: z.string().trim().min(1).max(4_000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(
    request,
    projectId,
    "specReconcile.read",
  );
  if (gate instanceof Response) return gate;

  const baselines = await prisma.tbSpSourceBaseline.findMany({
    where: { prjct_id: projectId, use_yn: "Y" },
    orderBy: [{ mdfcn_dt: "desc" }],
  });
  return apiSuccess({
    items: baselines.map((baseline) => ({
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
      lastReceiptId: baseline.last_receipt_id,
      reconciledMemberId: baseline.reconciled_mber_id,
      reconciledAt: baseline.reconciled_dt?.toISOString() ?? null,
      metadata: baseline.checkpoint_metadata_data,
    })),
  });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(
    request,
    projectId,
    "specReconcile.review",
  );
  if (gate instanceof Response) return gate;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }
  const parsed = createSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(
      "VALIDATION_ERROR",
      "source baseline 승인 정보가 올바르지 않습니다.",
      400,
      { issues: parsed.error.issues },
    );
  }
  const body = parsed.data;
  if (!isValidCheckpoint(body.checkpointType, body.checkpoint)) {
    return apiError(
      "VALIDATION_ERROR",
      "checkpoint 형식이 checkpointType과 맞지 않습니다.",
      400,
    );
  }

  try {
    let providerVerification: Prisma.InputJsonObject | null = null;
    if (body.repoProvider === "GITHUB" || body.repoProvider === "GITLAB") {
      if (body.checkpointType !== "GIT_COMMIT") {
        return apiError(
          "PROVIDER_REQUIRES_GIT_COMMIT",
          "Git provider 기준선은 GIT_COMMIT checkpoint만 사용할 수 있습니다.",
          400,
        );
      }
      const verified = await verifyConfiguredProviderDiff({
        projectId,
        repoKey: body.repoKey,
        baseCheckpoint: body.checkpoint,
        headCheckpoint: body.checkpoint,
      });
      if (verified.provider !== body.repoProvider) {
        return apiError(
          "PROVIDER_MISMATCH",
          "repoKey에 연결된 provider와 선택한 provider가 다릅니다.",
          400,
        );
      }
      providerVerification = {
        provider: verified.provider,
        repositoryPath: verified.repositoryPath,
        verifiedAt: verified.verifiedAt,
      };
    }
    const baseline = await prisma.tbSpSourceBaseline.create({
      data: {
        prjct_id: projectId,
        repo_key: body.repoKey,
        repo_provider_code: body.repoProvider,
        branch_nm: body.branchName,
        checkpoint_ty_code: body.checkpointType,
        last_reconciled_commit_sha:
          body.checkpointType === "GIT_COMMIT" ? body.checkpoint : null,
        last_reconciled_manifest_hash:
          body.checkpointType === "SOURCE_MANIFEST" ? body.checkpoint : null,
        checkpoint_version_no: 0,
        history_audit_code: body.historyAudit,
        reconciled_mber_id: gate.mberId,
        reconciled_dt: new Date(),
        checkpoint_metadata_data: {
          ...(body.metadata ?? {}),
          initialized: true,
          approvalReason: body.approvalReason,
          providerVerification,
        },
      },
    });
    return apiSuccess({ baselineId: baseline.baseline_id }, 201);
  } catch (error) {
    if (error instanceof SourceProviderError) {
      return apiError(error.code, error.message, error.status);
    }
    console.error(`[POST /api/projects/${projectId}/source-baselines] 오류:`, error);
    return apiError(
      "BASELINE_ALREADY_EXISTS",
      "이 저장소·브랜치의 source baseline이 이미 있습니다.",
      409,
    );
  }
}
