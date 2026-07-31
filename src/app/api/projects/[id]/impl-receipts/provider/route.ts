/**
 * Git provider가 직접 검증한 Type B 변경 제출.
 *
 * 요청자가 evidenceTrust를 정하지 않는다. 서버가 provider compare 결과로 source
 * evidence와 Diff hash를 교체한 뒤에만 PROVIDER_VERIFIED로 저장한다.
 */

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { requirePermission } from "@/lib/requirePermission";
import {
  receiptSubmissionSchema,
  type ReceiptSubmission,
} from "@/lib/spec-reconciliation/contracts";
import {
  createReconciliationReceipt,
  ReceiptSubmissionError,
} from "@/lib/spec-reconciliation/createReceipt";
import {
  SourceProviderError,
  verifyConfiguredProviderDiff,
} from "@/lib/spec-reconciliation/sourceProvider";
import {
  BatchPlanningError,
  queueReconciliationBatchAnalysis,
} from "@/lib/spec-reconciliation/batchPlanner";

type RouteParams = { params: Promise<{ id: string }> };

const providerReceiptSchema = receiptSubmissionSchema.omit({
  repoProvider: true,
  checkpointType: true,
  headStable: true,
  evidenceTrust: true,
  evidenceVerify: true,
  ancestryVerified: true,
  diffHash: true,
  evidenceVerifyData: true,
  sourceEvidence: true,
  manifest: true,
});

const requestSchema = z.object({ receipt: providerReceiptSchema });

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(
    request,
    projectId,
    "specReconcile.submit",
  );
  if (gate instanceof Response) return gate;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }
  const parsed = requestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(
      "VALIDATION_ERROR",
      "provider 검증 제출 형식이 올바르지 않습니다.",
      400,
      { issues: parsed.error.issues },
    );
  }
  const requested = parsed.data.receipt;
  try {
    const verified = await verifyConfiguredProviderDiff({
      projectId,
      repoKey: requested.repoKey,
      baseCheckpoint: requested.baseCheckpoint,
      headCheckpoint: requested.headCheckpoint,
    });
    const providerEvidence = {
      provider: verified.provider,
      repositoryPath: verified.repositoryPath,
      baseCheckpoint: verified.baseCheckpoint,
      headCheckpoint: verified.headCheckpoint,
      commitCount: verified.commitCount,
      secretRedactionCount: verified.secretRedactionCount,
      verifiedAt: verified.verifiedAt,
      files: verified.files,
    };
    const submission: ReceiptSubmission = {
      ...requested,
      repoProvider: verified.provider,
      checkpointType: "GIT_COMMIT",
      headStable: true,
      baseCheckpoint: verified.baseCheckpoint,
      headCheckpoint: verified.headCheckpoint,
      evidenceTrust: "PROVIDER_VERIFIED",
      evidenceVerify: "VERIFIED",
      ancestryVerified: true,
      diffHash: verified.diffHash,
      sourceEvidence: providerEvidence,
      evidenceVerifyData: {
        verifiedBy: "SPECODE_PROVIDER_API",
        verifiedAt: verified.verifiedAt,
        provider: verified.provider,
      },
      manifest: undefined,
      proposals: requested.proposals.map((proposal) => ({
        ...proposal,
        sourceEvidence: providerEvidence,
      })),
    };
    const result = await prisma.$transaction((tx) =>
      createReconciliationReceipt(tx, submission, {
        projectId,
        memberId: gate.mberId,
        originType: "MAINTENANCE",
        allowBaselineCreate: false,
      }),
    );
    const batchAnalysis = submission.proposals.length === 0
      ? await queueReconciliationBatchAnalysis({
          receiptId: result.receiptId,
          projectId,
          memberId: gate.mberId,
          scope: submission.analysisScope ?? {
            changedPaths: verified.files.map((file) => file.path),
            includeProjectIndex: true,
            autoBatch: true,
          },
        })
      : null;
    return apiSuccess(
      {
        ...result,
        batchAnalysis,
        evidenceTrust: "PROVIDER_VERIFIED",
        reviewUrl:
          `/projects/${projectId}/spec-reconciliations/${result.receiptId}`,
      },
      result.idempotent ? 200 : 201,
    );
  } catch (error) {
    if (error instanceof BatchPlanningError) {
      return apiError(error.code, error.message, error.status);
    }
    if (error instanceof SourceProviderError) {
      return apiError(error.code, error.message, error.status);
    }
    if (error instanceof ReceiptSubmissionError) {
      return apiError(error.code, error.message, error.status);
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return apiError("RECEIPT_ALREADY_EXISTS", "동일한 접수가 이미 있습니다.", 409);
    }
    console.error(
      `[POST /api/projects/${projectId}/impl-receipts/provider] 오류:`,
      error,
    );
    return apiError("DB_ERROR", "provider 검증 변경 제출에 실패했습니다.", 500);
  }
}
