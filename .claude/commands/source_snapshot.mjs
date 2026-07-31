#!/usr/bin/env node
/**
 * /run-ai-tasks IMPLEMENT 작업 전후의 로컬 소스 스냅샷.
 *
 * Git commit 여부와 무관하게 텍스트 소스의 경로·SHA-256·내용을 로컬 gzip JSON에
 * 보관한다. .env, 키/인증서, 생성물은 항상 제외한다.
 *
 * 사용법:
 *   node .claude/commands/source_snapshot.mjs capture --output BEFORE.json.gz
 *   node .claude/commands/source_snapshot.mjs compare BEFORE.json.gz AFTER.json.gz --output DIFF.json
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = process.env.SPECODE_SOURCE_ROOT
  ? path.resolve(process.env.SPECODE_SOURCE_ROOT)
  : path.resolve(SCRIPT_DIR, "..", "..");
const SNAPSHOT_STORE = path.join(PROJECT_ROOT, ".claude", "specode", "snapshots");
const EXCLUDED_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "tmp",
  "uploads",
  "__pycache__",
]);
const EXCLUDED_PREFIXES = [".claude/tmp", ".claude/specode"];
const EXCLUDED_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.test",
]);
const EXCLUDED_SUFFIXES = new Set([
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".crt",
  ".cer",
  ".der",
  ".jks",
]);
const TEXT_SUFFIXES = new Set([
  ".c", ".cc", ".cpp", ".cs", ".css", ".go", ".graphql", ".h", ".html",
  ".java", ".js", ".jsx", ".json", ".kt", ".kts", ".md", ".mjs", ".cjs",
  ".php", ".prisma", ".ps1", ".py", ".rb", ".rs", ".scss", ".sh", ".sql",
  ".svelte", ".toml", ".ts", ".tsx", ".vue", ".xml", ".yaml", ".yml",
]);
const MAX_FILE_BYTES = 1_000_000;
const MAX_EVIDENCE_CHARS = 200_000;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function redactSecrets(value) {
  return value
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "[REDACTED_SECRET]",
    )
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16})\b/g,
      "[REDACTED_SECRET]",
    )
    .replace(
      /((?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["']?)([^"'\s,;]{8,})/gi,
      "$1[REDACTED_SECRET]",
    );
}

function relativePath(filePath) {
  return path.relative(PROJECT_ROOT, filePath).split(path.sep).join("/");
}

function isExcluded(filePath) {
  const relative = relativePath(filePath);
  const name = path.basename(filePath).toLowerCase();
  if (EXCLUDED_NAMES.has(name) || name.startsWith(".env.")) return true;
  if (EXCLUDED_SUFFIXES.has(path.extname(name))) return true;
  return EXCLUDED_PREFIXES.some(
    (prefix) => relative === prefix || relative.startsWith(`${prefix}/`),
  );
}

function isExcludedRelative(relative) {
  const normalized = relative.split(path.sep).join("/");
  const name = path.basename(normalized).toLowerCase();
  if (EXCLUDED_NAMES.has(name) || name.startsWith(".env.")) return true;
  if (EXCLUDED_SUFFIXES.has(path.extname(name))) return true;
  const segments = normalized.split("/");
  if (segments.some((segment) => EXCLUDED_DIRS.has(segment))) return true;
  return EXCLUDED_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

function collectCandidatePaths(directory, output) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name) && !isExcluded(fullPath)) {
        collectCandidatePaths(fullPath, output);
      }
      continue;
    }
    if (
      entry.isFile() &&
      TEXT_SUFFIXES.has(path.extname(entry.name).toLowerCase()) &&
      !isExcluded(fullPath)
    ) {
      output.push(fullPath);
    }
  }
}

function collectFiles() {
  const paths = [];
  const files = {};
  const skippedFiles = [];
  collectCandidatePaths(PROJECT_ROOT, paths);

  for (const filePath of paths) {
    const relative = relativePath(filePath);
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_FILE_BYTES) {
        skippedFiles.push(relative);
        continue;
      }
      const raw = fs.readFileSync(filePath);
      const content = new TextDecoder("utf-8", { fatal: true }).decode(raw);
      files[relative] = { sha256: sha256(raw), content };
    } catch {
      skippedFiles.push(relative);
    }
  }
  return { files, skippedFiles };
}

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

function runGitCommand(args) {
  return spawnSync("git", args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 20 * 1024 * 1024,
  });
}

function repositoryIdentity() {
  const remote = runGit(["config", "--get", "remote.origin.url"]);
  const identity = remote || path.basename(PROJECT_ROOT);
  return {
    repoKey: `local-${sha256(identity).slice(0, 24)}`,
    branchName: (runGit(["branch", "--show-current"]) || "working-tree").slice(0, 200),
  };
}

function computeManifestHash(files) {
  const digest = crypto.createHash("sha256");
  for (const [relative, item] of Object.entries(files).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    digest.update(relative, "utf8");
    digest.update("\0");
    digest.update(item.sha256, "ascii");
    digest.update("\n");
  }
  return digest.digest("hex");
}

function writeGzipJson(outputPath, value) {
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, zlib.gzipSync(JSON.stringify(value)));
}

function persistSnapshot(payload) {
  fs.mkdirSync(SNAPSHOT_STORE, { recursive: true });
  const storedPath = path.join(SNAPSHOT_STORE, `${payload.manifestHash}.json.gz`);
  if (!fs.existsSync(storedPath)) writeGzipJson(storedPath, payload);
  return storedPath;
}

function readGzipJson(inputPath) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(inputPath)).toString("utf8"));
}

function focusedPatch(relative, before, after) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] ===
      afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const contextStart = Math.max(0, prefix - 3);
  const beforeEnd = Math.min(beforeLines.length, beforeLines.length - suffix + 3);
  const afterEnd = Math.min(afterLines.length, afterLines.length - suffix + 3);
  const lines = [`--- a/${relative}`, `+++ b/${relative}`];
  for (const line of beforeLines.slice(contextStart, prefix)) lines.push(` ${line}`);
  for (const line of beforeLines.slice(prefix, beforeEnd - Math.min(3, suffix))) {
    lines.push(`-${line}`);
  }
  for (const line of afterLines.slice(prefix, afterEnd - Math.min(3, suffix))) {
    lines.push(`+${line}`);
  }
  if (suffix > 0) {
    for (const line of afterLines.slice(Math.max(prefix, afterLines.length - Math.min(3, suffix)))) {
      lines.push(` ${line}`);
    }
  }
  const patch = redactSecrets(`${lines.join("\n")}\n`);
  return patch.length > MAX_EVIDENCE_CHARS
    ? `${patch.slice(0, MAX_EVIDENCE_CHARS)}\n... [local evidence truncated] ...\n`
    : patch;
}

function capture(outputPath) {
  const { files, skippedFiles } = collectFiles();
  const identity = repositoryIdentity();
  const payload = {
    version: 1,
    ...identity,
    manifestHash: computeManifestHash(files),
    files,
    skippedFiles,
    security: {
      environmentFilesExcluded: true,
      privateKeyFilesExcluded: true,
    },
  };
  writeGzipJson(outputPath, payload);
  const storedPath = persistSnapshot(payload);
  console.log(JSON.stringify({
    output: outputPath,
    ...identity,
    manifestHash: payload.manifestHash,
    fileCount: Object.keys(files).length,
    skippedCount: skippedFiles.length,
    storedPath: relativePath(storedPath),
  }));
}

function compare(beforePath, afterPath, outputPath) {
  const before = readGzipJson(beforePath);
  const after = readGzipJson(afterPath);
  if (before.repoKey !== after.repoKey) {
    throw new Error("before/after 스냅샷의 저장소 식별자가 다릅니다.");
  }

  const changes = [];
  const allPaths = new Set([
    ...Object.keys(before.files || {}),
    ...Object.keys(after.files || {}),
  ]);
  for (const relative of [...allPaths].sort()) {
    const previous = before.files[relative];
    const current = after.files[relative];
    if (previous && current && previous.sha256 === current.sha256) continue;
    const beforeContent = previous?.content || "";
    const afterContent = current?.content || "";
    changes.push({
      path: relative,
      status: !previous ? "ADDED" : !current ? "DELETED" : "MODIFIED",
      beforeHash: previous?.sha256 || null,
      afterHash: current?.sha256 || null,
      patch: focusedPatch(relative, beforeContent, afterContent),
    });
  }

  const payload = {
    version: 1,
    repoKey: after.repoKey,
    branchName: after.branchName,
    checkpointType: "SOURCE_MANIFEST",
    baseCheckpoint: before.manifestHash,
    headCheckpoint: after.manifestHash,
    changedFileCount: changes.length,
    changes,
    security: {
      ...after.security,
      sensitiveValuesRedacted: changes.some((change) =>
        change.patch.includes("[REDACTED_SECRET]"),
      ),
    },
    headStable: true,
  };
  payload.diffHash = sha256(JSON.stringify(changes));
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify({
    output: outputPath,
    baseCheckpoint: payload.baseCheckpoint,
    headCheckpoint: payload.headCheckpoint,
    changedFileCount: changes.length,
  }));
}

function identify() {
  const identity = repositoryIdentity();
  const gitCommit = runGit(["rev-parse", "HEAD"]);
  const gitRoot = runGit(["rev-parse", "--show-toplevel"]);
  console.log(JSON.stringify({
    ...identity,
    isGit: Boolean(gitRoot && gitCommit),
    currentCommit: gitCommit,
    workingTreeDirty: Boolean(runGit(["status", "--porcelain"])),
  }));
}

function gitChanges(baseCommit) {
  const statusResult = runGitCommand([
    "diff",
    "--name-status",
    "--find-renames",
    baseCommit,
    "--",
  ]);
  if (statusResult.status !== 0) {
    throw new Error(
      `Git 변경 파일 조회 실패: ${statusResult.stderr.trim() || "unknown error"}`,
    );
  }
  const changes = [];
  for (const line of statusResult.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const columns = line.split("\t");
    const rawStatus = columns[0];
    const relative = (columns.at(-1) || "").split(path.sep).join("/");
    if (!relative || isExcludedRelative(relative)) continue;
    const extension = path.extname(relative).toLowerCase();
    if (extension && !TEXT_SUFFIXES.has(extension)) continue;
    const patchResult = runGitCommand([
      "diff",
      "--no-ext-diff",
      "--unified=3",
      "--text",
      baseCommit,
      "--",
      relative,
    ]);
    const patch = patchResult.status === 0
      ? redactSecrets(patchResult.stdout).slice(0, MAX_EVIDENCE_CHARS)
      : "";
    changes.push({
      path: relative,
      status: rawStatus.startsWith("A")
        ? "ADDED"
        : rawStatus.startsWith("D")
          ? "DELETED"
          : rawStatus.startsWith("R")
            ? "RENAMED"
            : "MODIFIED",
      patch,
    });
  }

  // git diff는 untracked 파일을 포함하지 않는다. 새 API/컴포넌트가 통째로 누락되면
  // 의미 분석이 틀어지므로 exclude 규칙을 통과한 텍스트 파일을 ADDED patch로 보강한다.
  const untrackedResult = runGitCommand([
    "ls-files",
    "--others",
    "--exclude-standard",
  ]);
  if (untrackedResult.status === 0) {
    for (const rawPath of untrackedResult.stdout.split(/\r?\n/)) {
      const relative = rawPath.trim().split(path.sep).join("/");
      if (!relative || isExcludedRelative(relative)) continue;
      const extension = path.extname(relative).toLowerCase();
      if (extension && !TEXT_SUFFIXES.has(extension)) continue;
      const fullPath = path.join(PROJECT_ROOT, relative);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > MAX_FILE_BYTES) continue;
        const content = fs.readFileSync(fullPath, "utf8");
        const addedLines = content.split("\n").map((line) => `+${line}`);
        const patch = redactSecrets([
          "--- /dev/null",
          `+++ b/${relative}`,
          ...addedLines,
        ].join("\n")).slice(0, MAX_EVIDENCE_CHARS);
        changes.push({ path: relative, status: "ADDED", patch });
      } catch {
        // 파일이 조회 중 사라지면 다음 실행에서 다시 수집한다.
      }
    }
  }
  changes.sort((left, right) => left.path.localeCompare(right.path));
  return changes;
}

function compareGitCurrent(baseCommit, outputPath) {
  const headCommit = runGit(["rev-parse", "HEAD"]);
  if (!headCommit) throw new Error("현재 Git HEAD를 확인할 수 없습니다.");
  const exists = runGitCommand(["cat-file", "-e", `${baseCommit}^{commit}`]);
  if (exists.status !== 0) {
    throw new Error(
      "서버 baseline commit이 로컬 저장소에 없습니다. fetch 후 다시 실행하거나 baseline을 확인하세요.",
    );
  }
  const ancestry = runGitCommand([
    "merge-base",
    "--is-ancestor",
    baseCommit,
    headCommit,
  ]).status === 0;
  if (!ancestry) {
    throw new Error(
      "baseline commit이 현재 HEAD의 조상이 아닙니다. force-push 또는 branch 분기를 확인하세요.",
    );
  }

  const { files } = collectFiles();
  const manifestHash = computeManifestHash(files);
  const dirty = Boolean(runGit(["status", "--porcelain"]));
  const identity = repositoryIdentity();
  const changes = gitChanges(baseCommit);
  const payload = {
    version: 2,
    ...identity,
    checkpointType: "GIT_COMMIT",
    baseCheckpoint: baseCommit,
    headCheckpoint: dirty ? `WORKTREE:${manifestHash}` : headCommit,
    headCommit,
    headStable: !dirty,
    ancestryVerified: ancestry,
    changedFileCount: changes.length,
    changes,
    diffHash: sha256(JSON.stringify(changes)),
    security: {
      environmentFilesExcluded: true,
      privateKeyFilesExcluded: true,
      sensitiveValuesRedacted: changes.some((change) =>
        change.patch.includes("[REDACTED_SECRET]"),
      ),
    },
  };
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify({
    output: outputPath,
    baseCheckpoint: payload.baseCheckpoint,
    headCheckpoint: payload.headCheckpoint,
    headStable: payload.headStable,
    changedFileCount: changes.length,
    diffHash: payload.diffHash,
  }));
}

function compareManifestCurrent(baseManifestHash, outputPath) {
  const storedPath = path.join(SNAPSHOT_STORE, `${baseManifestHash}.json.gz`);
  if (!fs.existsSync(storedPath)) {
    throw new Error(
      `로컬 baseline snapshot이 없습니다: ${baseManifestHash}. ` +
      "기준선을 만든 작업공간에서 실행하거나 새 baseline을 승인하세요.",
    );
  }
  const currentPath = path.join(
    PROJECT_ROOT,
    ".claude",
    "tmp",
    `specode_current_${Date.now()}.json.gz`,
  );
  capture(currentPath);
  compare(storedPath, currentPath, outputPath);
}

function compareCurrent(args) {
  const baseType = optionValue(args, "--base-type");
  const base = optionValue(args, "--base");
  const output = optionValue(args, "--output");
  if (!["GIT_COMMIT", "SOURCE_MANIFEST"].includes(baseType) || !base || !output) {
    throw new Error(
      "compare-current에는 --base-type GIT_COMMIT|SOURCE_MANIFEST --base VALUE --output FILE이 필요합니다.",
    );
  }
  if (baseType === "GIT_COMMIT") compareGitCurrent(base, output);
  else compareManifestCurrent(base, output);
}

function optionValue(args, option) {
  const index = args.indexOf(option);
  return index >= 0 ? args[index + 1] : null;
}

function main() {
  const [, , command, ...args] = process.argv;
  try {
    if (command === "capture") {
      const output = optionValue(args, "--output");
      if (!output) throw new Error("capture에는 --output이 필요합니다.");
      capture(output);
      return;
    }
    if (command === "compare") {
      const output = optionValue(args, "--output");
      const positional = args.filter(
        (value, index) => value !== "--output" && args[index - 1] !== "--output",
      );
      if (!output || positional.length !== 2) {
        throw new Error("compare에는 BEFORE AFTER --output FILE이 필요합니다.");
      }
      compare(positional[0], positional[1], output);
      return;
    }
    if (command === "identify") {
      identify();
      return;
    }
    if (command === "compare-current") {
      compareCurrent(args);
      return;
    }
    throw new Error(
      "명령은 capture, compare, identify 또는 compare-current여야 합니다.",
    );
  } catch (error) {
    console.error(`오류: source snapshot 처리 실패: ${error.message}`);
    process.exit(1);
  }
}

main();
