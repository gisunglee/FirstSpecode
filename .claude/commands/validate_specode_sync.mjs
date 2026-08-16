#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
if (!args.repo || !args.input) {
  fail("사용법: node validate_specode_sync.mjs --repo <저장소> --input <결과.json>");
}

const repositoryRoot = await realpath(path.resolve(args.repo));
const raw = await readFile(path.resolve(args.input), "utf8");
let result;
try {
  result = JSON.parse(raw);
} catch {
  fail("결과 파일이 올바른 JSON이 아닙니다.");
}

if (result?.resultStatus === "FAILED") {
  if (!nonEmpty(result.errorMessage)) fail("FAILED에는 errorMessage가 필요합니다.");
  pass();
}

if (result?.resultStatus === "NEEDS_INPUT") {
  const scope = result.sourceScope;
  if (scope?.status !== "NEEDS_INPUT" || !Array.isArray(scope.questions) || scope.questions.length === 0) {
    fail("NEEDS_INPUT에는 하나 이상의 질문이 필요합니다.");
  }
  for (const file of scope.files ?? []) await resolveSafeFile(file.path, false);
  pass();
}

if (result?.resultStatus !== "ANALYZED" || !result.analysis) {
  fail("resultStatus는 ANALYZED, NEEDS_INPUT 또는 FAILED여야 합니다.");
}

const analysis = result.analysis;
if (analysis.sourceScope?.status !== "CONFIRMED") {
  fail("ANALYZED의 sourceScope는 CONFIRMED여야 합니다.");
}
if (!Array.isArray(analysis.sourceScope.files) || analysis.sourceScope.files.length === 0) {
  fail("확정 sourceScope에는 하나 이상의 파일이 필요합니다.");
}

const sourceFiles = new Set();
for (const file of analysis.sourceScope.files) {
  const normalized = normalizeRelativePath(file.path);
  if (sourceFiles.has(normalized)) fail(`중복 sourceScope 경로: ${file.path}`);
  await resolveSafeFile(normalized, true);
  sourceFiles.add(normalized);
}

const findings = [
  ...(analysis.implementation?.items ?? []),
  ...(analysis.designCoverage?.items ?? []),
];
for (const finding of findings) {
  for (const evidence of finding.evidence ?? []) {
    const normalized = normalizeRelativePath(evidence.path);
    if (!sourceFiles.has(normalized)) fail(`sourceScope 밖 evidence: ${evidence.path}`);
    if (!Number.isInteger(evidence.startLine) || !Number.isInteger(evidence.endLine) ||
        evidence.startLine < 1 || evidence.endLine < evidence.startLine) {
      fail(`잘못된 evidence 줄 범위: ${evidence.path}`);
    }
    const filePath = await resolveSafeFile(normalized, true);
    const content = (await readFile(filePath, "utf8")).replaceAll("\r\n", "\n");
    const lines = content.split("\n");
    if (evidence.endLine > lines.length) fail(`파일 범위를 벗어난 evidence: ${evidence.path}`);
    const actualSnippet = lines.slice(evidence.startLine - 1, evidence.endLine).join("\n");
    const safeSnippet = redactCredentials(actualSnippet);
    const expectedSnippet = evidence.redacted ? safeSnippet : actualSnippet;
    if (expectedSnippet !== evidence.snippet) {
      fail(`실제 줄 원문과 snippet이 다릅니다: ${evidence.path}:${evidence.startLine}`);
    }
    if (containsCredential(actualSnippet) && !evidence.redacted) {
      fail(`credential 가능성이 있는 snippet은 제출할 수 없습니다: ${evidence.path}`);
    }
    if (evidence.redacted && safeSnippet === actualSnippet) {
      fail(`redacted=true지만 가려진 credential이 없습니다: ${evidence.path}`);
    }
    const actualHash = sha256(expectedSnippet);
    if (String(evidence.snippetHash).toLowerCase() !== actualHash) {
      fail(`snippetHash가 일치하지 않습니다: ${evidence.path}:${evidence.startLine}`);
    }
  }
}

pass();

async function resolveSafeFile(relativePath, mustExist) {
  const normalized = normalizeRelativePath(relativePath);
  const candidate = path.resolve(repositoryRoot, normalized);
  if (!isInside(repositoryRoot, candidate)) fail(`저장소 밖 경로: ${relativePath}`);
  if (!mustExist) return candidate;
  let resolved;
  try {
    resolved = await realpath(candidate);
  } catch {
    fail(`파일을 찾을 수 없습니다: ${relativePath}`);
  }
  if (!isInside(repositoryRoot, resolved)) fail(`symlink가 저장소 밖을 가리킵니다: ${relativePath}`);
  return resolved;
}

function normalizeRelativePath(value) {
  if (!nonEmpty(value)) fail("빈 저장소 경로는 허용하지 않습니다.");
  const normalized = value.trim().replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[a-z]:\//i.test(normalized) || normalized.split("/").includes("..")) {
    fail(`저장소 상대 경로만 허용합니다: ${value}`);
  }
  const wrapped = `/${normalized.toLowerCase()}/`;
  const blocked = ["/.git/", "/node_modules/", "/.next/", "/dist/", "/build/", "/vendor/", "/generated/"];
  if (blocked.some((segment) => wrapped.includes(segment)) ||
      /(^|\/)\.env(?:\.|$)/i.test(normalized) ||
      /\.(pem|key|p12|pfx|crt|cer)$/i.test(normalized)) {
    fail(`분석 제외 경로입니다: ${value}`);
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
    .replace(
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
      "[REDACTED_PRIVATE_KEY]",
    )
    .replace(/\b(?:sk|spk|ghp|github_pat)_[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_TOKEN]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi, "Bearer [REDACTED_TOKEN]")
    .replace(
      /((?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'`])([^"'`\r\n]{12,})(["'`])/gi,
      "$1[REDACTED_SECRET]$3",
    );
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, "");
    if (key) parsed[key] = argv[index + 1];
  }
  return parsed;
}

function fail(message) {
  console.error(`INVALID: ${message}`);
  process.exit(1);
}

function pass() {
  console.log("VALID");
  process.exit(0);
}
