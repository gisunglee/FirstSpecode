#!/usr/bin/env node
/**
 * /sync-specode가 만든 Type B receipt JSON을 Worker API에 전송한다.
 *
 * 사용법:
 *   node .claude/commands/submit_maintenance_receipt.mjs <receipt_json>
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
  const payloadFile = process.argv[2];
  if (!payloadFile || !fs.existsSync(payloadFile)) {
    throw new Error(
      "사용법: node submit_maintenance_receipt.mjs <receipt_json>",
    );
  }
  const payload = JSON.parse(fs.readFileSync(payloadFile, "utf8"));
  const baseUrl = (process.env.SPECODE_URL || "http://localhost:3000")
    .replace(/\/$/, "");
  const workerKey = (process.env.SPECODE_WORKER_KEY || "").trim();
  if (!workerKey.startsWith("spk_")) {
    throw new Error("SPECODE_WORKER_KEY 환경변수가 없거나 형식이 잘못되었습니다.");
  }

  const response = await fetch(
    `${baseUrl}/api/worker/spec-reconciliations/maintenance`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Mcp-Key": workerKey,
      },
      body: JSON.stringify(payload),
    },
  );
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);
  console.log("[후속 변경 스펙 정합성 접수]");
  console.log(text);
}

main().catch((error) => {
  console.error(`오류: ${error.message}`);
  process.exit(1);
});

