/**
 * 프로젝트 GitHub/GitLab 연결 조회·등록.
 *
 * token은 응답하지 않으며, 연결 시 실제 provider repository 조회가 성공해야 저장한다.
 */

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { requirePermission } from "@/lib/requirePermission";
import { encryptApiKey, maskApiKey } from "@/lib/encrypt";
import {
  probeProviderConnection,
  SourceProviderError,
} from "@/lib/spec-reconciliation/sourceProvider";

type RouteParams = { params: Promise<{ id: string }> };

const createSchema = z.object({
  repoKey: z.string().trim().min(1).max(200),
  provider: z.enum(["GITHUB", "GITLAB"]),
  repositoryPath: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/)
    .max(500),
  defaultBranch: z.string().trim().min(1).max(200).optional(),
  token: z.string().trim().max(10_000).optional(),
  webhookSecret: z.string().trim().min(16).max(1_000).optional(),
});

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(
    request,
    projectId,
    "specReconcile.read",
  );
  if (gate instanceof Response) return gate;

  const items = await prisma.tbSpSourceRepository.findMany({
    where: { prjct_id: projectId, use_yn: "Y" },
    orderBy: { mdfcn_dt: "desc" },
    select: {
      repository_id: true,
      repo_key: true,
      provider_code: true,
      provider_repository_path: true,
      repository_url: true,
      default_branch_nm: true,
      mask_token_val: true,
      webhook_active_yn: true,
      creat_dt: true,
      mdfcn_dt: true,
    },
  });
  return apiSuccess({
    canConnect: gate.role === "OWNER" || gate.role === "ADMIN",
    items: items.map((item) => ({
      repositoryId: item.repository_id,
      repoKey: item.repo_key,
      provider: item.provider_code,
      repositoryPath: item.provider_repository_path,
      repositoryUrl: item.repository_url,
      defaultBranch: item.default_branch_nm,
      maskedToken: item.mask_token_val,
      webhookActive: item.webhook_active_yn === "Y",
      createdAt: item.creat_dt.toISOString(),
      updatedAt: item.mdfcn_dt.toISOString(),
    })),
  });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(
    request,
    projectId,
    "specReconcile.connectProvider",
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
      "Git provider 연결 정보가 올바르지 않습니다.",
      400,
      { issues: parsed.error.issues },
    );
  }
  const body = parsed.data;
  const apiBaseUrl =
    body.provider === "GITHUB"
      ? "https://api.github.com"
      : "https://gitlab.com/api/v4";

  try {
    const probe = await probeProviderConnection({
      provider: body.provider,
      repositoryPath: body.repositoryPath,
      apiBaseUrl,
      token: body.token ?? null,
    });
    const existing = await prisma.tbSpSourceRepository.findUnique({
      where: {
        prjct_id_repo_key: {
          prjct_id: projectId,
          repo_key: body.repoKey,
        },
      },
      select: {
        encpt_token_val: true,
        mask_token_val: true,
        encpt_webhook_secret_val: true,
      },
    });
    const repository = await prisma.tbSpSourceRepository.upsert({
      where: {
        prjct_id_repo_key: {
          prjct_id: projectId,
          repo_key: body.repoKey,
        },
      },
      create: {
        prjct_id: projectId,
        repo_key: body.repoKey,
        provider_code: body.provider,
        provider_repository_path: body.repositoryPath,
        repository_url: probe.repositoryUrl,
        api_base_url: apiBaseUrl,
        default_branch_nm: body.defaultBranch ?? probe.defaultBranch,
        encpt_token_val: body.token ? encryptApiKey(body.token) : null,
        mask_token_val: body.token ? maskApiKey(body.token) : null,
        encpt_webhook_secret_val: body.webhookSecret
          ? encryptApiKey(body.webhookSecret)
          : null,
        webhook_active_yn: body.webhookSecret ? "Y" : "N",
        creat_mber_id: gate.mberId,
      },
      update: {
        provider_code: body.provider,
        provider_repository_path: body.repositoryPath,
        repository_url: probe.repositoryUrl,
        api_base_url: apiBaseUrl,
        default_branch_nm: body.defaultBranch ?? probe.defaultBranch,
        encpt_token_val: body.token
          ? encryptApiKey(body.token)
          : existing?.encpt_token_val,
        mask_token_val: body.token
          ? maskApiKey(body.token)
          : existing?.mask_token_val,
        encpt_webhook_secret_val: body.webhookSecret
          ? encryptApiKey(body.webhookSecret)
          : existing?.encpt_webhook_secret_val,
        webhook_active_yn:
          body.webhookSecret || existing?.encpt_webhook_secret_val ? "Y" : "N",
        use_yn: "Y",
        mdfcn_dt: new Date(),
      },
    });
    return apiSuccess({
      repositoryId: repository.repository_id,
      repoKey: repository.repo_key,
      provider: repository.provider_code,
      repositoryPath: repository.provider_repository_path,
      defaultBranch: repository.default_branch_nm,
      maskedToken: repository.mask_token_val,
      webhookActive: repository.webhook_active_yn === "Y",
    }, existing ? 200 : 201);
  } catch (error) {
    if (error instanceof SourceProviderError) {
      return apiError(error.code, error.message, error.status);
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return apiError(
        "SOURCE_REPOSITORY_ALREADY_EXISTS",
        "같은 repoKey의 provider 연결이 이미 있습니다.",
        409,
      );
    }
    console.error(
      `[POST /api/projects/${projectId}/source-repositories] 오류:`,
      error,
    );
    return apiError("DB_ERROR", "Git provider 연결 저장에 실패했습니다.", 500);
  }
}
