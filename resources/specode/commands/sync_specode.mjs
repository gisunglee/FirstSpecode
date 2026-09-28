#!/usr/bin/env node
/** /sync-specode의 프로젝트 확인·실행 생성·로컬 근거 생성·직접 제출 CLI. */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  PROJECT_ROOT,
  ensureSafeWorkDir,
  hashSourceScope,
  prepareSubmission,
  readJson,
  requestWorkerJson,
  validateSubmission,
  writeJson,
} from "./spec_sync_local.mjs";

const [, , command, ...args] = process.argv;

async function main() {
  switch (command) {
    case "context":
      return printContext(args);
    case "start":
      return startRun(args);
    case "hash-scope":
      return hashScope(args);
    case "prepare":
      return prepare(args);
    case "validate":
      return validate(args);
    case "submit":
      return submit(args);
    case "cleanup":
      return cleanup(args);
    default:
      throw new Error(usage());
  }
}

async function printContext([unitWorkRef, rawMode]) {
  const mode = parseMode(rawMode);
  assertUnitWorkRef(unitWorkRef);
  const result = await requestWorkerJson("/api/worker/tasks?statusOnly=true");
  const meta = result.meta ?? {};
  console.log("[동기화 대상 확인]");
  console.log(`프로젝트: ${meta.prjctName ?? "(프로젝트명 미상)"}`);
  console.log(`프로젝트 ID: ${meta.prjctId ?? "(확인 불가)"}`);
  console.log(`단위업무: ${unitWorkRef}`);
  console.log(`모드: ${mode}`);
}

async function startRun([unitWorkRef, rawMode, rawWorkDir]) {
  const mode = parseMode(rawMode);
  assertUnitWorkRef(unitWorkRef);
  if (!rawWorkDir) throw new Error(usage());
  const workDir = ensureSafeWorkDir(rawWorkDir, true);
  const requestPath = path.join(workDir, "request.json");
  const request = fs.existsSync(requestPath)
    ? readJson(requestPath)
    : {
        unitWorkRef,
        mode,
        clientSubmissionKey: randomUUID(),
      };
  if (request.unitWorkRef !== unitWorkRef || request.mode !== mode) {
    throw new Error("같은 작업 폴더를 다른 UW 또는 모드에 재사용할 수 없습니다.");
  }
  writeJson(requestPath, request);
  const data = await requestWorkerJson("/api/worker/spec-syncs", {
    method: "POST",
    body: JSON.stringify(request),
  });
  writeStartFiles(data, workDir);
  console.log(`[실행 생성] ${data.syncRunId}`);
  console.log(`프로젝트: ${data.projectName} (${data.projectId})`);
  console.log(`단위업무: ${data.unitWorkDisplayId} · ${data.designSnapshot.unitWork.name}`);
  console.log(`점검 대상: ${data.designSnapshot.targets.length}건`);
  console.log(`작업 폴더: ${path.relative(PROJECT_ROOT, workDir)}`);
}

function hashScope([inputPath, outputPath]) {
  if (!inputPath || !outputPath) throw new Error(usage());
  const raw = readJson(inputPath);
  const scope = raw.sourceScope ?? raw;
  writeJson(outputPath, hashSourceScope(scope));
  console.log(`[소스 범위 고정] ${scope.files.length}개 파일`);
}

function prepare([draftPath, outputPath]) {
  if (!draftPath || !outputPath) throw new Error(usage());
  const result = prepareSubmission(readJson(draftPath));
  writeJson(outputPath, result);
  console.log(`[제출 파일 준비] ${outputPath}`);
}

function validate([inputPath]) {
  if (!inputPath) throw new Error(usage());
  validateSubmission(readJson(inputPath));
  console.log("VALID");
}

async function submit([runId, inputPath]) {
  if (!runId || !inputPath) throw new Error(usage());
  const result = readJson(inputPath);
  validateSubmission(result);
  const response = await requestWorkerJson(`/api/worker/spec-syncs/${runId}/result`, {
    method: "POST",
    body: JSON.stringify(result),
  });
  console.log(`[제출 완료] runId=${runId} status=${response.sync_sttus_code ?? response.status}`);
  console.log(`구현 정합성=${response.implementation_verdict_code ?? "-"}`);
  console.log(`설계 커버리지=${response.design_coverage_verdict_code ?? "-"}`);
}

function cleanup([rawWorkDir]) {
  if (!rawWorkDir) throw new Error(usage());
  const workDir = ensureSafeWorkDir(rawWorkDir, false);
  if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: false });
  console.log(`[임시 파일 정리] ${path.relative(PROJECT_ROOT, workDir)}`);
}

function writeStartFiles(data, workDir) {
  const snapshot = data.designSnapshot;
  const targetDir = path.join(workDir, "targets");
  fs.mkdirSync(targetDir, { recursive: true });
  const targetIndex = snapshot.targets.map((target, index) => {
    const fileName = `${String(index + 1).padStart(3, "0")}-${safeName(target.displayId)}-${target.targetType}.json`;
    writeJson(path.join(targetDir, fileName), target);
    const { value: _value, ...metadata } = target;
    return { ...metadata, targetFile: `targets/${fileName}` };
  });
  writeJson(path.join(workDir, "discovery.json"), {
    projectId: snapshot.projectId,
    unitWork: snapshot.unitWork,
    requirements: snapshot.requirements,
    userStories: snapshot.userStories,
    acceptanceCriteria: snapshot.acceptanceCriteria,
    apiRefs: snapshot.apiRefs,
    dbRefs: snapshot.dbRefs,
    targets: targetIndex,
  });
  writeJson(path.join(workDir, "manifest.json"), {
    syncRunId: data.syncRunId,
    projectId: data.projectId,
    projectName: data.projectName,
    requesterName: data.requesterName,
    mode: data.mode,
    status: data.status,
    unitWorkDisplayId: data.unitWorkDisplayId,
    unitWorkName: snapshot.unitWork.name,
    designSnapshotHash: data.designSnapshotHash,
    targetCount: targetIndex.length,
    discoveryFile: "discovery.json",
  });
}

function parseMode(value = "CHECK") {
  const mode = value.toUpperCase();
  if (!["CHECK", "DEEP_SYNC"].includes(mode)) throw new Error("모드는 CHECK 또는 DEEP_SYNC입니다.");
  return mode;
}

function assertUnitWorkRef(value) {
  if (!/^UW-\d{5}$/.test(value ?? "")) throw new Error("단위업무는 UW-XXXXX 형식이어야 합니다.");
}

function safeName(value) {
  return String(value).replace(/[^A-Za-z0-9_-]/g, "_");
}

function usage() {
  return [
    "사용법:",
    "  node sync_specode.mjs context UW-XXXXX CHECK|DEEP_SYNC",
    "  node sync_specode.mjs start UW-XXXXX CHECK|DEEP_SYNC .claude/tmp/spec-sync-<id>",
    "  node sync_specode.mjs hash-scope <scope.json> <hashed-scope.json>",
    "  node sync_specode.mjs prepare <draft.json> <final.json>",
    "  node sync_specode.mjs validate <final.json>",
    "  node sync_specode.mjs submit <runId> <final.json>",
    "  node sync_specode.mjs cleanup .claude/tmp/spec-sync-<id>",
  ].join("\n");
}

main().catch((error) => {
  console.error(`오류: ${error.message}`);
  process.exit(1);
});
