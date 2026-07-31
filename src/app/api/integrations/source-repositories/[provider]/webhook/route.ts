/**
 * 서명된 GitHub PR / GitLab MR webhook을 Type B receipt와 분석 태스크로 수집한다.
 *
 * provider payload의 Diff를 믿지 않고 연결된 provider API로 base→head를 다시 조회한다.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptApiKey } from "@/lib/encrypt";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { createReconciliationReceipt } from "@/lib/spec-reconciliation/createReceipt";
import { queueReconciliationBatchAnalysis } from "@/lib/spec-reconciliation/batchPlanner";
import {
  SourceProviderError,
  verifyConfiguredProviderDiff,
} from "@/lib/spec-reconciliation/sourceProvider";

type RouteParams = { params: Promise<{ provider: string }> };

type WebhookChange = {
  repositoryPath: string;
  branchName: string;
  headCheckpoint: string;
  requestKey: string;
  requestUrl: string | null;
  title: string;
};

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { provider: rawProvider } = await params;
  const provider = rawProvider.toUpperCase();
  if (!["GITHUB", "GITLAB"].includes(provider)) {
    return apiError("NOT_FOUND", "지원하지 않는 source provider입니다.", 404);
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > 2_000_000) {
    return apiError("PAYLOAD_TOO_LARGE", "webhook payload가 너무 큽니다.", 413);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 webhook JSON이 아닙니다.", 400);
  }
  const change =
    provider === "GITHUB"
      ? extractGitHubChange(request, payload)
      : extractGitLabChange(request, payload);
  if (change === "IGNORED") {
    return apiSuccess({ accepted: true, ignored: true }, 202);
  }
  if (!change) {
    return apiError(
      "INVALID_WEBHOOK",
      "repository와 변경 checkpoint를 확인할 수 없습니다.",
      400,
    );
  }

  const connections = await prisma.tbSpSourceRepository.findMany({
    where: {
      provider_code: provider,
      provider_repository_path: change.repositoryPath,
      webhook_active_yn: "Y",
      use_yn: "Y",
    },
  });
  if (connections.length === 0) {
    return apiSuccess({ accepted: true, ignored: true }, 202);
  }
  const connection = connections.find((candidate) =>
    verifyWebhookSignature(
      provider,
      request,
      rawBody,
      candidate.encpt_webhook_secret_val,
    ),
  );
  if (!connection) {
    return apiError(
      "INVALID_WEBHOOK_SIGNATURE",
      "webhook 서명이 일치하지 않습니다.",
      401,
    );
  }
  if (!connection.creat_mber_id) {
    return apiError(
      "WEBHOOK_OWNER_REQUIRED",
      "webhook 분석 태스크 소유자가 없습니다. provider 연결을 다시 저장해 주세요.",
      412,
    );
  }
  const ownerMemberId = connection.creat_mber_id;

  const baseline = await prisma.tbSpSourceBaseline.findUnique({
    where: {
      prjct_id_repo_key_branch_nm: {
        prjct_id: connection.prjct_id,
        repo_key: connection.repo_key,
        branch_nm: change.branchName,
      },
    },
  });
  const baseCheckpoint = baseline?.last_reconciled_commit_sha;
  if (
    !baseline ||
    baseline.checkpoint_ty_code !== "GIT_COMMIT" ||
    !baseCheckpoint
  ) {
    return apiError(
      "SOURCE_BASELINE_REQUIRED",
      "PR 대상 브랜치의 승인된 Git source baseline이 필요합니다.",
      412,
    );
  }

  try {
    const verified = await verifyConfiguredProviderDiff({
      projectId: connection.prjct_id,
      repoKey: connection.repo_key,
      baseCheckpoint,
      headCheckpoint: change.headCheckpoint,
    });
    const evidence = {
      provider: verified.provider,
      repositoryPath: verified.repositoryPath,
      baseCheckpoint: verified.baseCheckpoint,
      headCheckpoint: verified.headCheckpoint,
      commitCount: verified.commitCount,
      secretRedactionCount: verified.secretRedactionCount,
      verifiedAt: verified.verifiedAt,
      files: verified.files,
      webhook: {
        requestKey: change.requestKey,
        requestUrl: change.requestUrl,
      },
    };
    const result = await prisma.$transaction(async (tx) => {
      const created = await createReconciliationReceipt(
        tx,
        {
          clientSubmissionKey:
            `${provider.toLowerCase()}-${change.requestKey}-` +
            verified.headCheckpoint,
          repoKey: connection.repo_key,
          repoProvider: verified.provider,
          branchName: change.branchName,
          checkpointType: "GIT_COMMIT",
          baseCheckpoint: verified.baseCheckpoint,
          headCheckpoint: verified.headCheckpoint,
          headStable: true,
          evidenceTrust: "PROVIDER_VERIFIED",
          evidenceVerify: "VERIFIED",
          ancestryVerified: true,
          diffHash: verified.diffHash,
          evidenceVerifyData: {
            verifiedBy: "SPECODE_PROVIDER_WEBHOOK",
            verifiedAt: verified.verifiedAt,
          },
          sourceEvidence: evidence,
          selectedTargets: [],
          summary: change.title,
          analysisVersion: "spec-reconcile/provider-webhook-v1",
          prUrl: change.requestUrl ?? undefined,
          proposals: [],
        },
        {
          projectId: connection.prjct_id,
          memberId: ownerMemberId,
          originType: "MAINTENANCE",
          allowBaselineCreate: false,
        },
      );
      if (!created.idempotent) {
        await tx.tbSpImplReceipt.update({
          where: { receipt_id: created.receiptId },
          data: { review_sttus_code: "ANALYZING", mdfcn_dt: new Date() },
        });
      }
      return created;
    });

    const batchAnalysis = await queueReconciliationBatchAnalysis({
      receiptId: result.receiptId,
      projectId: connection.prjct_id,
      memberId: ownerMemberId,
      scope: {
        changedPaths: verified.files.map((file) => file.path),
        includeProjectIndex: true,
        instruction:
          "Provider webhook으로 수집된 변경이다. provider 검증 Diff와 연결 후보를 기준으로 분석한다.",
        autoBatch: true,
      },
    });

    return apiSuccess({
      accepted: true,
      receiptId: result.receiptId,
      status: result.status,
      idempotent: result.idempotent,
      batchAnalysis,
    }, result.idempotent ? 200 : 202);
  } catch (error) {
    if (error instanceof SourceProviderError) {
      return apiError(error.code, error.message, error.status);
    }
    console.error(`[source provider ${provider} webhook] 오류:`, error);
    return apiError("WEBHOOK_PROCESSING_FAILED", "webhook 처리에 실패했습니다.", 500);
  }
}

function extractGitHubChange(
  request: NextRequest,
  payload: unknown,
): WebhookChange | "IGNORED" | null {
  if (request.headers.get("x-github-event") !== "pull_request") return "IGNORED";
  const body = asRecord(payload);
  const action = stringField(body, "action");
  if (!["opened", "reopened", "synchronize"].includes(action ?? "")) {
    return "IGNORED";
  }
  const repository = asRecord(body?.repository);
  const pullRequest = asRecord(body?.pull_request);
  const base = asRecord(pullRequest?.base);
  const head = asRecord(pullRequest?.head);
  const repositoryPath = stringField(repository, "full_name");
  const branchName = stringField(base, "ref");
  const headCheckpoint = stringField(head, "sha");
  const number = numberField(body, "number");
  if (!repositoryPath || !branchName || !headCheckpoint || number == null) {
    return null;
  }
  return {
    repositoryPath,
    branchName,
    headCheckpoint,
    requestKey: `pr-${number}`,
    requestUrl: stringField(pullRequest, "html_url"),
    title: stringField(pullRequest, "title") ?? `GitHub PR #${number}`,
  };
}

function extractGitLabChange(
  request: NextRequest,
  payload: unknown,
): WebhookChange | "IGNORED" | null {
  if (request.headers.get("x-gitlab-event") !== "Merge Request Hook") {
    return "IGNORED";
  }
  const body = asRecord(payload);
  const attributes = asRecord(body?.object_attributes);
  const action = stringField(attributes, "action");
  if (!["open", "reopen", "update"].includes(action ?? "")) return "IGNORED";
  const project = asRecord(body?.project);
  const lastCommit = asRecord(attributes?.last_commit);
  const repositoryPath = stringField(project, "path_with_namespace");
  const branchName = stringField(attributes, "target_branch");
  const headCheckpoint =
    stringField(lastCommit, "id") ?? stringField(attributes, "last_commit_sha");
  const iid = numberField(attributes, "iid");
  if (!repositoryPath || !branchName || !headCheckpoint || iid == null) {
    return null;
  }
  return {
    repositoryPath,
    branchName,
    headCheckpoint,
    requestKey: `mr-${iid}`,
    requestUrl: stringField(attributes, "url"),
    title: stringField(attributes, "title") ?? `GitLab MR !${iid}`,
  };
}

function verifyWebhookSignature(
  provider: string,
  request: NextRequest,
  rawBody: string,
  encryptedSecret: string | null,
) {
  if (!encryptedSecret) return false;
  const secret = decryptApiKey(encryptedSecret);
  if (provider === "GITHUB") {
    const provided = request.headers.get("x-hub-signature-256");
    if (!provided) return false;
    const expected =
      `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    return constantTimeEqual(expected, provided);
  }
  const provided = request.headers.get("x-gitlab-token");
  return provided ? constantTimeEqual(secret, provided) : false;
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(value: Record<string, unknown> | null, key: string) {
  const found = value?.[key];
  return typeof found === "string" ? found : null;
}

function numberField(value: Record<string, unknown> | null, key: string) {
  const found = value?.[key];
  return typeof found === "number" ? found : null;
}
