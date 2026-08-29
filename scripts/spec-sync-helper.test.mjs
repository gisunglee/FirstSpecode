/** /sync-specode 로컬 helper의 근거 생성·소스 변경 차단·경량 흐름을 검증한다. */

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  hashSourceScope,
  prepareSubmission,
  validateSubmission,
} from "../.claude/commands/spec_sync_local.mjs";

const resultPath = "scripts/fixtures/spec-sync-valid-result.json";

function fixture() {
  return JSON.parse(fs.readFileSync(resultPath, "utf8"));
}

test("helper가 path와 줄 범위에서 snippet·hash를 결정적으로 만든다", () => {
  const draft = fixture();
  draft.analysis.implementation.issues[0].evidence = [{
    path: "scripts/fixtures/spec-sync-source.ts",
    symbol: "add",
    startLine: 1,
    endLine: 3,
  }];
  const prepared = prepareSubmission(draft, process.cwd());
  const evidence = prepared.analysis.implementation.issues[0].evidence[0];
  assert.equal(evidence.snippet, "export function add(left: number, right: number) {\n  return left + right;\n}");
  assert.match(evidence.snippetHash, /^[a-f0-9]{64}$/);
  assert.equal(evidence.redacted, false);
  assert.doesNotThrow(() => validateSubmission(prepared, process.cwd()));
});

test("분석 시작 뒤 소스 hash가 다르면 제출 파일을 만들지 않는다", () => {
  const draft = fixture();
  draft.analysis.sourceScope.files[0].contentHash = "0".repeat(64);
  assert.throws(
    () => prepareSubmission(draft, process.cwd()),
    /분석 중 소스가 변경되었습니다/,
  );
});

test("source scope hash는 로컬 파일에서 프로그램이 만든다", () => {
  const scope = fixture().analysis.sourceScope;
  delete scope.files[0].contentHash;
  const hashed = hashSourceScope(scope, process.cwd());
  assert.equal(
    hashed.files[0].contentHash,
    "254adcb50cf6367f665961fb89d42fcd4c346e0528642438220f8c0529626e6b",
  );
});

test("실행 응답과 명령은 snapshot 중복 prompt와 MCP 대용량 제출을 사용하지 않는다", () => {
  const startService = fs.readFileSync("src/lib/spec-sync/startService.ts", "utf8");
  const command = fs.readFileSync(".claude/commands/sync-specode.md", "utf8");
  assert.doesNotMatch(startService, /sourceDiscoveryPrompt|analysisPromptTemplate/);
  assert.match(command, /sync_specode\.mjs submit/);
  assert.doesNotMatch(command, /submit_spec_sync_result/);
});

test("MCP 커맨드 재설치는 새 helper를 배포하고 폐기 validator를 제거한다", () => {
  const distribution = fs.readFileSync(
    "src/lib/mcp/workerCommandFiles.ts",
    "utf8",
  );
  assert.match(distribution, /\.claude\/commands\/sync_specode\.mjs/);
  assert.match(distribution, /\.claude\/commands\/spec_sync_local\.mjs/);
  assert.match(distribution, /WORKER_COMMAND_REMOVE_PATHS/);
  assert.match(distribution, /\.claude\/commands\/validate_specode_sync\.mjs/);
});
