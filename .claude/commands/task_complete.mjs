#!/usr/bin/env node
/**
 * AI 태스크 결과 파일을 Worker Complete API에 전송한다.
 *
 * 사용법:
 *   node .claude/commands/task_complete.mjs <taskId> <DONE|FAILED> <result_file>
 */

import fs from "node:fs";
import path from "node:path";
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

async function main() {
  loadEnv();
  const [, , taskId, rawStatus, resultFile] = process.argv;
  const status = rawStatus?.toUpperCase();
  if (!taskId || !["DONE", "FAILED"].includes(status) || !resultFile) {
    throw new Error(
      "사용법: node task_complete.mjs <taskId> <DONE|FAILED> <result_file>",
    );
  }
  if (!fs.existsSync(resultFile)) throw new Error(`결과 파일 없음: ${resultFile}`);

  const resultCn = fs.readFileSync(resultFile, "utf8").trim();
  if (status === "DONE" && !resultCn) {
    throw new Error("DONE 상태는 결과 내용이 필요합니다.");
  }
  const baseUrl = (process.env.SPECODE_URL || "http://localhost:3000").replace(/\/$/, "");
  const workerKey = (process.env.SPECODE_WORKER_KEY || "").trim();
  if (!workerKey.startsWith("spk_")) {
    throw new Error("SPECODE_WORKER_KEY 환경변수가 없거나 형식이 잘못되었습니다.");
  }

  const response = await fetch(`${baseUrl}/api/worker/tasks/${taskId}/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Mcp-Key": workerKey,
    },
    body: JSON.stringify({ status, resultCn }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);
  console.log(`[완료] taskId=${taskId} status=${status}`);
  console.log(text);
}

main().catch((error) => {
  console.error(`오류: ${error.message}`);
  process.exit(1);
});
