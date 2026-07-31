#!/usr/bin/env node
/**
 * /sync-specode 분석 입력 준비.
 *
 * 서버 baseline 조회 → 로컬 Diff/manifest 수집까지 수행한다.
 * 설계 원문·연결지도 조회와 컨텍스트 분할은 receipt 제출 뒤 서버 배치 planner가 맡는다.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..", "..");

function loadEnv() {
  for (const fileName of [".env.local", ".env"]) {
    const envPath = path.join(PROJECT_ROOT, fileName);
    if (!fs.existsSync(envPath)) continue;
    for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const separator = line.indexOf("=");
      const key = line.slice(0, separator).trim();
      const value = line
        .slice(separator + 1)
        .trim()
        .replace(/^['"]|['"]$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
    break;
  }
}

function parseLastJson(stdout) {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // helper가 안내 문장을 출력해도 마지막 JSON 객체를 찾을 때까지 거슬러 올라간다.
    }
  }
  throw new Error(`도구 응답에서 JSON을 찾을 수 없습니다: ${stdout.slice(0, 500)}`);
}

function runSnapshot(args) {
  const result = spawnSync(
    process.execPath,
    [path.join(SCRIPT_DIR, "source_snapshot.mjs"), ...args],
    {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 30 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "source snapshot 실행 실패");
  }
  return parseLastJson(result.stdout);
}

async function apiFetch(baseUrl, workerKey, apiPath) {
  const response = await fetch(`${baseUrl}${apiPath}`, {
    headers: { "X-Mcp-Key": workerKey },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `[${body.code || response.status}] ${body.message || "SPECODE API 호출 실패"}`,
    );
  }
  return body.data ?? body;
}

async function main() {
  loadEnv();
  const unitWork = process.argv[2]?.trim() || null;
  const baseUrl = (process.env.SPECODE_URL || "http://localhost:3000")
    .replace(/\/$/, "");
  const workerKey = (process.env.SPECODE_WORKER_KEY || "").trim();
  if (!workerKey.startsWith("spk_")) {
    throw new Error("SPECODE_WORKER_KEY 환경변수가 없거나 형식이 잘못되었습니다.");
  }

  const identity = runSnapshot(["identify"]);
  const baselineQuery = new URLSearchParams({
    repoKey: identity.repoKey,
    branchName: identity.branchName,
  });
  const baseline = await apiFetch(
    baseUrl,
    workerKey,
    `/api/worker/spec-reconciliations/baseline?${baselineQuery}`,
  );

  const tempDir = path.join(PROJECT_ROOT, ".claude", "tmp");
  fs.mkdirSync(tempDir, { recursive: true });
  const diffPath = path.join(tempDir, "specode_sync_diff.json");
  runSnapshot([
    "compare-current",
    "--base-type",
    baseline.checkpointType,
    "--base",
    baseline.checkpoint,
    "--output",
    diffPath,
  ]);
  const diff = JSON.parse(fs.readFileSync(diffPath, "utf8"));

  const analysisScope = {
    unitWorkRef: unitWork,
    changedPaths: diff.changes.map((change) => change.path),
    includeProjectIndex: !unitWork,
    autoBatch: true,
  };

  const outputPath = path.join(tempDir, "specode_sync_input.json");
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseline,
        identity,
        requestedUnitWork: unitWork,
        diff,
        analysisScope,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(JSON.stringify({
    output: path.relative(PROJECT_ROOT, outputPath).split(path.sep).join("/"),
    projectId: baseline.projectId,
    checkpointType: baseline.checkpointType,
    baseCheckpoint: baseline.checkpoint,
    headCheckpoint: diff.headCheckpoint,
    headStable: diff.headStable,
    changedFileCount: diff.changedFileCount,
    autoBatch: true,
    requestedUnitWork: unitWork,
  }));
}

main().catch((error) => {
  console.error(`오류: ${error.message}`);
  process.exit(1);
});
