/**
 * GitHub/GitLab에서 commit 존재, base→head ancestry, 실제 Diff를 서버가 직접 검증한다.
 *
 * provider 연결 정보는 AI API key와 분리된 tb_sp_source_repository에서만 읽는다.
 * PROVIDER_VERIFIED 등급은 이 모듈의 성공 결과로만 만들 수 있다.
 */

import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { decryptApiKey } from "@/lib/encrypt";

export class SourceProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

type ProviderConnection = {
  provider_code: string;
  provider_repository_path: string;
  api_base_url: string;
  encpt_token_val: string | null;
};

export type VerifiedProviderDiff = {
  provider: "GITHUB" | "GITLAB";
  repositoryPath: string;
  baseCheckpoint: string;
  headCheckpoint: string;
  ancestryVerified: true;
  diffHash: string;
  files: Array<{
    path: string;
    previousPath?: string;
    status: string;
    blobSha?: string;
    patch?: string;
  }>;
  commitCount: number;
  secretRedactionCount: number;
  verifiedAt: string;
};

export async function verifyConfiguredProviderDiff(input: {
  projectId: string;
  repoKey: string;
  baseCheckpoint: string;
  headCheckpoint: string;
}) {
  const connection = await prisma.tbSpSourceRepository.findFirst({
    where: {
      prjct_id: input.projectId,
      repo_key: input.repoKey,
      use_yn: "Y",
    },
    select: {
      provider_code: true,
      provider_repository_path: true,
      api_base_url: true,
      encpt_token_val: true,
    },
  });
  if (!connection) {
    throw new SourceProviderError(
      "SOURCE_PROVIDER_NOT_CONNECTED",
      "이 repoKey에 연결된 Git provider가 없습니다.",
      412,
    );
  }
  return verifyProviderDiff(connection, input.baseCheckpoint, input.headCheckpoint);
}

export async function probeProviderConnection(input: {
  provider: "GITHUB" | "GITLAB";
  repositoryPath: string;
  apiBaseUrl: string;
  token: string | null;
}) {
  const connection: ProviderConnection = {
    provider_code: input.provider,
    provider_repository_path: input.repositoryPath,
    api_base_url: input.apiBaseUrl,
    encpt_token_val: null,
  };
  const headers = providerHeaders(connection, input.token);
  const path =
    input.provider === "GITHUB"
      ? `/repos/${input.repositoryPath}`
      : `/projects/${encodeURIComponent(input.repositoryPath)}`;
  const repository = await providerFetch<Record<string, unknown>>(
    `${input.apiBaseUrl}${path}`,
    headers,
  );
  return {
    defaultBranch:
      typeof repository.default_branch === "string"
        ? repository.default_branch
        : "main",
    repositoryUrl:
      typeof repository.html_url === "string"
        ? repository.html_url
        : typeof repository.web_url === "string"
          ? repository.web_url
          : null,
  };
}

async function verifyProviderDiff(
  connection: ProviderConnection,
  base: string,
  head: string,
): Promise<VerifiedProviderDiff> {
  if (connection.provider_code === "GITHUB") {
    return verifyGitHub(connection, base, head);
  }
  if (connection.provider_code === "GITLAB") {
    return verifyGitLab(connection, base, head);
  }
  throw new SourceProviderError(
    "UNSUPPORTED_SOURCE_PROVIDER",
    "PROVIDER_VERIFIED는 GitHub와 GitLab 연결만 지원합니다.",
    400,
  );
}

async function verifyGitHub(
  connection: ProviderConnection,
  base: string,
  head: string,
): Promise<VerifiedProviderDiff> {
  const token = decryptToken(connection.encpt_token_val);
  const headers = providerHeaders(connection, token);
  const root = `${connection.api_base_url}/repos/${connection.provider_repository_path}`;
  const [baseCommit, headCommit, compare] = await Promise.all([
    providerFetch<Record<string, unknown>>(
      `${root}/commits/${encodeURIComponent(base)}`,
      headers,
    ),
    providerFetch<Record<string, unknown>>(
      `${root}/commits/${encodeURIComponent(head)}`,
      headers,
    ),
    providerFetch<{
      status?: string;
      ahead_by?: number;
      total_commits?: number;
      commits?: Array<unknown>;
      files?: Array<{
        filename?: string;
        previous_filename?: string;
        status?: string;
        sha?: string;
        patch?: string;
      }>;
    }>(
      `${root}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
      headers,
    ),
  ]);
  const baseSha = stringField(baseCommit, "sha");
  const headSha = stringField(headCommit, "sha");
  if (!baseSha || !headSha) {
    throw new SourceProviderError(
      "PROVIDER_COMMIT_INVALID",
      "GitHub commit 응답에서 SHA를 확인할 수 없습니다.",
    );
  }
  if (!["ahead", "identical"].includes(compare.status ?? "")) {
    throw new SourceProviderError(
      "INVALID_ANCESTRY",
      "GitHub에서 base commit이 head commit의 조상이 아님을 확인했습니다.",
    );
  }
  const totalCommits = compare.total_commits ?? compare.ahead_by ?? 0;
  if (
    (compare.commits && totalCommits > compare.commits.length) ||
    (compare.files?.length ?? 0) >= 300
  ) {
    throw new SourceProviderError(
      "PROVIDER_DIFF_TRUNCATED",
      "GitHub compare 응답이 잘려 있어 전체 Diff를 검증할 수 없습니다. 범위를 줄여 제출해 주세요.",
      413,
    );
  }
  const files = (compare.files ?? []).map((file) => ({
    path: file.filename ?? "",
    ...(file.previous_filename
      ? { previousPath: file.previous_filename }
      : {}),
    status: file.status ?? "modified",
    ...(file.sha ? { blobSha: file.sha } : {}),
    ...(file.patch ? { patch: file.patch } : {}),
  }));
  return verifiedResult(
    "GITHUB",
    connection.provider_repository_path,
    baseSha,
    headSha,
    files,
    totalCommits,
  );
}

async function verifyGitLab(
  connection: ProviderConnection,
  base: string,
  head: string,
): Promise<VerifiedProviderDiff> {
  const token = decryptToken(connection.encpt_token_val);
  const headers = providerHeaders(connection, token);
  const projectPath = encodeURIComponent(connection.provider_repository_path);
  const root = `${connection.api_base_url}/projects/${projectPath}`;
  const mergeBaseQuery = new URLSearchParams();
  mergeBaseQuery.append("refs[]", base);
  mergeBaseQuery.append("refs[]", head);
  const compareQuery = new URLSearchParams({
    from: base,
    to: head,
    straight: "true",
  });
  const [baseCommit, headCommit, mergeBase, compare] = await Promise.all([
    providerFetch<Record<string, unknown>>(
      `${root}/repository/commits/${encodeURIComponent(base)}`,
      headers,
    ),
    providerFetch<Record<string, unknown>>(
      `${root}/repository/commits/${encodeURIComponent(head)}`,
      headers,
    ),
    providerFetch<Record<string, unknown> | Array<Record<string, unknown>>>(
      `${root}/repository/merge_base?${mergeBaseQuery}`,
      headers,
    ),
    providerFetch<{
      compare_timeout?: boolean;
      commits?: Array<unknown>;
      diffs?: Array<{
        old_path?: string;
        new_path?: string;
        new_file?: boolean;
        renamed_file?: boolean;
        deleted_file?: boolean;
        diff?: string;
      }>;
    }>(`${root}/repository/compare?${compareQuery}`, headers),
  ]);
  const baseSha = stringField(baseCommit, "id");
  const headSha = stringField(headCommit, "id");
  const mergeBaseValue = Array.isArray(mergeBase) ? mergeBase[0] : mergeBase;
  const mergeBaseSha = stringField(mergeBaseValue, "id");
  if (!baseSha || !headSha || mergeBaseSha !== baseSha) {
    throw new SourceProviderError(
      "INVALID_ANCESTRY",
      "GitLab에서 base commit이 head commit의 조상임을 확인하지 못했습니다.",
    );
  }
  if (compare.compare_timeout) {
    throw new SourceProviderError(
      "PROVIDER_DIFF_TRUNCATED",
      "GitLab compare가 시간 제한으로 중단되어 전체 Diff를 검증할 수 없습니다.",
      413,
    );
  }
  const files = (compare.diffs ?? []).map((file) => ({
    path: file.new_path ?? file.old_path ?? "",
    ...(file.renamed_file && file.old_path
      ? { previousPath: file.old_path }
      : {}),
    status: file.new_file
      ? "added"
      : file.deleted_file
        ? "removed"
        : file.renamed_file
          ? "renamed"
          : "modified",
    ...(file.diff ? { patch: file.diff } : {}),
  }));
  return verifiedResult(
    "GITLAB",
    connection.provider_repository_path,
    baseSha,
    headSha,
    files,
    compare.commits?.length ?? 0,
  );
}

function verifiedResult(
  provider: "GITHUB" | "GITLAB",
  repositoryPath: string,
  baseCheckpoint: string,
  headCheckpoint: string,
  files: VerifiedProviderDiff["files"],
  commitCount: number,
): VerifiedProviderDiff {
  let secretRedactionCount = 0;
  const normalizedFiles = files
    .map((file) => {
      if (!file.patch) return file;
      const redacted = redactSecrets(file.patch);
      secretRedactionCount += redacted.count;
      return { ...file, patch: redacted.value };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  const evidenceBytes = Buffer.byteLength(
    JSON.stringify(normalizedFiles),
    "utf8",
  );
  if (evidenceBytes > 5_000_000) {
    throw new SourceProviderError(
      "PROVIDER_DIFF_TOO_LARGE",
      "검증된 Diff evidence가 5MB를 초과합니다. 변경 범위를 나눠 제출해 주세요.",
      413,
    );
  }
  return {
    provider,
    repositoryPath,
    baseCheckpoint,
    headCheckpoint,
    ancestryVerified: true,
    diffHash: createHash("sha256")
      .update(JSON.stringify(normalizedFiles))
      .digest("hex"),
    files: normalizedFiles,
    commitCount,
    secretRedactionCount,
    verifiedAt: new Date().toISOString(),
  };
}

function redactSecrets(value: string) {
  let count = 0;
  const replace = () => {
    count += 1;
    return "[REDACTED_SECRET]";
  };
  const redacted = value
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      replace,
    )
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16})\b/g,
      replace,
    )
    .replace(
      /((?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["']?)([^"'\s,;]{8,})/gi,
      (_match, prefix: string) => `${prefix}${replace()}`,
    );
  return { value: redacted, count };
}

function providerHeaders(
  connection: ProviderConnection,
  explicitToken?: string | null,
) {
  const token =
    explicitToken === undefined
      ? decryptToken(connection.encpt_token_val)
      : explicitToken;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "SPECODE-source-reconciliation",
  };
  if (token) {
    if (connection.provider_code === "GITHUB") {
      headers.Authorization = `Bearer ${token}`;
      headers["X-GitHub-Api-Version"] = "2022-11-28";
    } else {
      headers["PRIVATE-TOKEN"] = token;
    }
  }
  return headers;
}

function decryptToken(encrypted: string | null) {
  return encrypted ? decryptApiKey(encrypted) : null;
}

async function providerFetch<T>(
  url: string,
  headers: Record<string, string>,
): Promise<T> {
  const response = await fetch(url, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const retryAfter = response.headers.get("retry-after");
    throw new SourceProviderError(
      response.status === 404
        ? "PROVIDER_RESOURCE_NOT_FOUND"
        : response.status === 401 || response.status === 403
          ? "PROVIDER_AUTH_FAILED"
          : "PROVIDER_REQUEST_FAILED",
      `Git provider 조회 실패(${response.status})` +
        (retryAfter ? ` · retry-after ${retryAfter}s` : ""),
      response.status === 404 ? 404 : 502,
    );
  }
  return response.json() as Promise<T>;
}

function stringField(
  value: Record<string, unknown> | undefined,
  field: string,
) {
  const found = value?.[field];
  return typeof found === "string" ? found : null;
}
