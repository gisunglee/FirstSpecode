/** /sync-specode 로컬 helper가 사용하는 파일 검증·근거 생성·HTTP 공통 함수. */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const TEMP_ROOT = path.join(PROJECT_ROOT, ".claude", "tmp");

export function loadWorkerSettings() {
  loadEnv();
  const baseUrl = (process.env.SPECODE_URL || "http://localhost:3000").replace(/\/$/, "");
  const workerKey = (process.env.SPECODE_WORKER_KEY || "").trim();
  if (!workerKey.startsWith("spk_")) {
    throw new Error("SPECODE_WORKER_KEY가 없거나 형식이 잘못되었습니다.");
  }
  return { baseUrl, workerKey };
}

export async function requestWorkerJson(urlPath, init = {}) {
  const { baseUrl, workerKey } = loadWorkerSettings();
  const response = await fetch(`${baseUrl}${urlPath}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Mcp-Key": workerKey,
      ...init.headers,
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`SPECODE 응답을 해석할 수 없습니다. HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`[${body.code ?? response.status}] ${body.message ?? "요청 실패"}`);
  }
  return body.data ?? body;
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

export function writeJson(filePath, value) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function ensureSafeWorkDir(rawPath, create = false) {
  const resolved = path.resolve(rawPath);
  const relative = path.relative(TEMP_ROOT, resolved);
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !path.basename(resolved).startsWith("spec-sync-")
  ) {
    throw new Error("작업 폴더는 .claude/tmp/spec-sync-* 형식이어야 합니다.");
  }
  if (create) fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

export function hashSourceScope(scope, repositoryRoot = PROJECT_ROOT) {
  if (scope?.status !== "CONFIRMED" || !Array.isArray(scope.files) || scope.files.length === 0) {
    throw new Error("확정된 sourceScope 파일이 필요합니다.");
  }
  return {
    ...scope,
    files: scope.files.map((file) => {
      const { fullPath } = resolveRepositoryFile(repositoryRoot, file.path);
      return { ...file, contentHash: sha256(fs.readFileSync(fullPath)) };
    }),
  };
}

export function prepareSubmission(rawResult, repositoryRoot = PROJECT_ROOT) {
  const result = structuredClone(rawResult);
  if (result?.resultStatus !== "ANALYZED") {
    validateSubmission(result, repositoryRoot);
    return result;
  }
  assertSourceScopeStable(result.analysis?.sourceScope, repositoryRoot);
  const findings = [
    ...(result.analysis?.implementation?.issues ?? []),
    ...(result.analysis?.designCoverage?.issues ?? []),
  ];
  for (const finding of findings) {
    finding.evidence = (finding.evidence ?? []).map((evidence) =>
      enrichEvidence(evidence, repositoryRoot),
    );
  }
  // 근거를 만드는 사이 파일이 바뀐 경우도 제출 전에 한 번 더 차단한다.
  assertSourceScopeStable(result.analysis.sourceScope, repositoryRoot);
  validateSubmission(result, repositoryRoot);
  return result;
}

export function validateSubmission(result, repositoryRoot = PROJECT_ROOT) {
  if (result?.resultStatus === "FAILED") {
    if (!nonEmpty(result.errorMessage)) throw new Error("FAILED에는 errorMessage가 필요합니다.");
    return;
  }
  if (result?.resultStatus === "NEEDS_INPUT") {
    if (result.sourceScope?.status !== "NEEDS_INPUT" || !result.sourceScope.questions?.length) {
      throw new Error("NEEDS_INPUT에는 하나 이상의 질문이 필요합니다.");
    }
    for (const file of result.sourceScope.files ?? []) {
      normalizeRepositoryPath(file.path);
    }
    return;
  }
  if (result?.resultStatus !== "ANALYZED" || !result.analysis) {
    throw new Error("resultStatus는 ANALYZED, NEEDS_INPUT 또는 FAILED여야 합니다.");
  }

  assertSourceScopeStable(result.analysis.sourceScope, repositoryRoot);
  const evaluated = result.analysis.implementation?.evaluatedTargets;
  if (!Array.isArray(evaluated) || evaluated.length === 0) {
    throw new Error("점검 완료 대상(evaluatedTargets)이 필요합니다.");
  }
  const evaluatedKeys = new Set();
  for (const target of evaluated) {
    const key = `${target.targetType}:${target.targetId}:${target.targetField}`;
    if (evaluatedKeys.has(key)) throw new Error(`중복 점검 대상: ${key}`);
    evaluatedKeys.add(key);
  }

  const implementationIssues = result.analysis.implementation?.issues ?? [];
  if (implementationIssues.some((item) => item.resultCode === "MATCH")) {
    throw new Error("정상(MATCH) 상세 결과는 제출하지 않습니다.");
  }
  const coverageIssues = result.analysis.designCoverage?.issues ?? [];
  if (coverageIssues.some((item) => ["IMPLEMENTATION_DETAIL", "OUT_OF_SCOPE"].includes(item.resultCode))) {
    throw new Error("정보성 커버리지 결과는 제출하지 않습니다.");
  }

  const scopePaths = new Set(
    result.analysis.sourceScope.files.map((file) => normalizeRepositoryPath(file.path)),
  );
  for (const finding of [...implementationIssues, ...coverageIssues]) {
    for (const evidence of finding.evidence ?? []) {
      validateEvidence(evidence, scopePaths, repositoryRoot);
    }
  }
}

function validateEvidence(evidence, scopePaths, repositoryRoot) {
  const normalized = normalizeRepositoryPath(evidence.path);
  if (!scopePaths.has(normalized)) throw new Error(`sourceScope 밖 evidence: ${evidence.path}`);
  if (!Number.isInteger(evidence.startLine) || !Number.isInteger(evidence.endLine) ||
      evidence.startLine < 1 || evidence.endLine < evidence.startLine) {
    throw new Error(`잘못된 evidence 줄 범위: ${evidence.path}`);
  }
  const actual = extractSnippet(repositoryRoot, normalized, evidence.startLine, evidence.endLine);
  const safe = redactCredentials(actual);
  const expected = evidence.redacted ? safe : actual;
  if (expected !== evidence.snippet) throw new Error(`실제 줄 원문과 snippet이 다릅니다: ${evidence.path}`);
  if (containsCredential(actual) && !evidence.redacted) {
    throw new Error(`credential 가능성이 있는 snippet은 제출할 수 없습니다: ${evidence.path}`);
  }
  if (String(evidence.snippetHash).toLowerCase() !== sha256(expected)) {
    throw new Error(`snippetHash가 일치하지 않습니다: ${evidence.path}`);
  }
}

function enrichEvidence(evidence, repositoryRoot) {
  const normalized = normalizeRepositoryPath(evidence.path);
  const snippet = extractSnippet(repositoryRoot, normalized, evidence.startLine, evidence.endLine);
  const redactedSnippet = redactCredentials(snippet);
  const redacted = redactedSnippet !== snippet;
  const safeSnippet = redacted ? redactedSnippet : snippet;
  return {
    path: normalized,
    symbol: evidence.symbol ?? null,
    startLine: evidence.startLine,
    endLine: evidence.endLine,
    snippet: safeSnippet,
    snippetHash: sha256(safeSnippet),
    redacted,
  };
}

function extractSnippet(repositoryRoot, relativePath, startLine, endLine) {
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
    throw new Error(`잘못된 evidence 줄 범위: ${relativePath}`);
  }
  const { fullPath } = resolveRepositoryFile(repositoryRoot, relativePath);
  const lines = fs.readFileSync(fullPath, "utf8").replaceAll("\r\n", "\n").split("\n");
  if (endLine > lines.length) throw new Error(`파일 범위를 벗어난 evidence: ${relativePath}`);
  return lines.slice(startLine - 1, endLine).join("\n");
}

function assertSourceScopeStable(scope, repositoryRoot) {
  if (scope?.status !== "CONFIRMED" || !scope.files?.length) {
    throw new Error("ANALYZED에는 확정 sourceScope가 필요합니다.");
  }
  const paths = new Set();
  for (const file of scope.files) {
    const normalized = normalizeRepositoryPath(file.path);
    if (paths.has(normalized)) throw new Error(`중복 sourceScope 경로: ${file.path}`);
    paths.add(normalized);
    if (!/^[a-f0-9]{64}$/i.test(file.contentHash ?? "")) {
      throw new Error(`sourceScope contentHash가 없습니다: ${file.path}`);
    }
    const { fullPath } = resolveRepositoryFile(repositoryRoot, normalized);
    const currentHash = sha256(fs.readFileSync(fullPath));
    if (currentHash !== file.contentHash.toLowerCase()) {
      throw new Error(`분석 중 소스가 변경되었습니다: ${file.path}`);
    }
  }
}

function resolveRepositoryFile(repositoryRoot, relativePath) {
  const normalized = normalizeRepositoryPath(relativePath);
  const root = fs.realpathSync(path.resolve(repositoryRoot));
  const candidate = path.resolve(root, normalized);
  if (!isInside(root, candidate) || !fs.existsSync(candidate)) {
    throw new Error(`저장소 파일을 찾을 수 없습니다: ${relativePath}`);
  }
  const fullPath = fs.realpathSync(candidate);
  if (!isInside(root, fullPath)) throw new Error(`symlink가 저장소 밖을 가리킵니다: ${relativePath}`);
  return { normalized, fullPath };
}

function normalizeRepositoryPath(value) {
  if (!nonEmpty(value)) throw new Error("빈 저장소 경로는 허용하지 않습니다.");
  const normalized = value.trim().replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[a-z]:\//i.test(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`저장소 상대 경로만 허용합니다: ${value}`);
  }
  const wrapped = `/${normalized.toLowerCase()}/`;
  const blocked = ["/.git/", "/node_modules/", "/.next/", "/dist/", "/build/", "/vendor/", "/generated/"];
  if (blocked.some((segment) => wrapped.includes(segment)) ||
      /(^|\/)\.env(?:\.|$)/i.test(normalized) ||
      /\.(?:pem|key|p12|pfx|crt|cer)$/i.test(normalized)) {
    throw new Error(`분석 제외 경로입니다: ${value}`);
  }
  return normalized;
}

function containsCredential(value) {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value) ||
    /\b(?:sk|spk|ghp|github_pat)_[A-Za-z0-9_-]{16,}\b/.test(value) ||
    /\bAKIA[0-9A-Z]{16}\b/.test(value) ||
    /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/i.test(value) ||
    /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'`][^"'`\r\n]{12,}["'`]/i.test(value);
}

function redactCredentials(value) {
  return value
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\b(?:sk|spk|ghp|github_pat)_[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_TOKEN]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi, "Bearer [REDACTED_TOKEN]")
    .replace(/((?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'`])([^"'`\r\n]{12,})(["'`])/gi, "$1[REDACTED_SECRET]$3");
}

function loadEnv() {
  for (const fileName of [".env.local", ".env"]) {
    const envPath = path.join(PROJECT_ROOT, fileName);
    if (!fs.existsSync(envPath)) continue;
    for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const separator = line.indexOf("=");
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
    break;
  }
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}
