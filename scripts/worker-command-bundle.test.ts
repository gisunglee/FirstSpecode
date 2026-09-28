/** MCP 설치 응답·격리 설치·업데이트 및 커맨드 입력 경계를 검증한다. 운영 서버/DB는 호출하지 않는다. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTools } from "../src/lib/mcp/register-tools";
import { getWorkerCommandBundle } from "../src/lib/mcp/workerCommandFiles";
import { WORKER_COMMAND_FILES } from "../src/lib/mcp/workerCommandManifest";
import nextConfig from "../next.config";
import { parseSpecodeArgs } from "../resources/specode/commands/specode_route.mjs";

const hash = (content: string) => createHash("sha256").update(content, "utf8").digest("hex");

test("공개 명령 8가지 사용 형태가 기존 workflow 인자로 연결된다", () => {
  const cases = [
    ["work", "run", ["SPEC"]], ["dev", "run", ["IMP"]],
    ["status", "run", ["STATUS"]], ["work task-123", "run", ["TASK", "task-123"]],
    ["review UW-00014", "review", ["UW-00014"]],
    ["sync UW-00014", "sync", ["UW-00014"]],
    ["sync UW-00014 --deep", "sync", ["UW-00014", "--deep"]],
    ["onboard", "onboard", []],
  ] as const;
  for (const [input, workflow, args] of cases) {
    assert.deepEqual(parseSpecodeArgs(input.split(" ")), { kind: "run", workflow, args });
  }
  assert.deepEqual(parseSpecodeArgs(["review", "14"]), parseSpecodeArgs(["review", "UW-00014"]));
  assert.deepEqual(parseSpecodeArgs(["sync", "14"]), parseSpecodeArgs(["sync", "UW-00014"]));
});

test("도움말·누락·잘못된 옵션은 실행으로 연결하지 않는다", () => {
  const inputs = [[], ["help"], ["--help"], ["review"], ["sync"], ["dev", "task-id"],
    ["onboard", "--deep"], ["work", "--deep"], ["work", "a", "b"], ["work", "a;echo"],
    ["sync", "UW-00014", "UW-00015"], ["review", "UW-00014", "--deep"],
    ["sync", "UW-00014", "--other"], ["sync", "0"], ["sync", "100000"],
    ["work", "--help"], ["unknown"], ["dev", "--type", "implement"]];
  for (const input of inputs) assert.equal(parseSpecodeArgs(input).kind, "help", input.join(" "));
});

test("배포 파일 전체가 고유한 고객 경로와 hash 및 빌드 tracing을 갖는다", () => {
  const bundle = getWorkerCommandBundle();
  assert.equal(bundle.bundleVersion, "2.0.0");
  assert.equal(bundle.files.length, 18);
  assert.equal(new Set(bundle.files.map((file) => file.path)).size, bundle.files.length);
  for (const file of bundle.files) {
    assert.ok(file.content.length > 0);
    assert.equal(file.sha256, hash(file.content));
    assert.ok(file.path.startsWith(".claude/"));
    assert.ok(!file.path.includes(".."));
    assert.ok(!bundle.removePaths.includes(file.path));
  }
  assert.deepEqual(nextConfig.outputFileTracingIncludes?.["/api/mcp"], WORKER_COMMAND_FILES.map((file) => `./${file.source}`));
  assert.ok(WORKER_COMMAND_FILES.every((file) => file.source.startsWith("resources/specode/")));
  assert.equal(bundle.bundleHash, hash(bundle.files.map((file) => `${file.path}:${file.sha256}`).join("\n")));
});

test("MCP tools/call로 받은 파일을 새 고객 저장소에 설치하고 재설치해도 동일하다", async () => {
  const server = new McpServer({ name: "specode-bundle-test", version: "1.0.0" });
  // 설치 도구는 일반 회원의 업무 API나 관리자 API를 호출할 필요가 없다.
  registerTools(server, async () => { throw new Error("설치 중 업무 API 호출 금지"); });
  const client = new Client({ name: "member-install-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const customerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "specode-command-test-"));
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({ name: "get_worker_command_files", arguments: {} });
    assert.ok(!result.isError);
    const blocks = result.content as Array<{ type: string; text?: string }>;
    const text = blocks.find((block) => block.type === "text")?.text;
    assert.ok(text);
    const bundle: ReturnType<typeof getWorkerCommandBundle> = JSON.parse(text);
    assert.deepEqual(bundle, getWorkerCommandBundle());
    fs.writeFileSync(path.join(customerRoot, ".env.local"), "CUSTOM_SETTING=preserve\n");
    for (let round = 0; round < 2; round++) {
      for (const file of bundle.files) {
        const target = path.resolve(customerRoot, file.path);
        assert.ok(target.startsWith(`${customerRoot}${path.sep}`));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, file.content, "utf8");
        assert.equal(hash(fs.readFileSync(target, "utf8")), file.sha256);
      }
    }
    assert.equal(fs.readFileSync(path.join(customerRoot, ".env.local"), "utf8"), "CUSTOM_SETTING=preserve\n");
    const routed = spawnSync(process.execPath, [".claude/commands/specode_route.mjs", "sync", "14", "--deep"], {
      cwd: customerRoot, encoding: "utf8",
    });
    assert.equal(routed.status, 0, routed.stderr);
    assert.deepEqual(JSON.parse(routed.stdout), { kind: "run", workflow: "sync", args: ["UW-00014", "--deep"] });
    // 설치 경로 기준의 helper 루트 계산 및 형제 모듈 import까지 검증한다.
    fs.mkdirSync(path.join(customerRoot, "scripts/fixtures"), { recursive: true });
    for (const name of ["spec-sync-source.ts", "spec-sync-valid-result.json"]) {
      fs.copyFileSync(`scripts/fixtures/${name}`, path.join(customerRoot, "scripts/fixtures", name));
    }
    const validated = spawnSync(process.execPath, [".claude/commands/sync_specode.mjs", "validate", "scripts/fixtures/spec-sync-valid-result.json"], {
      cwd: customerRoot, encoding: "utf8",
    });
    assert.equal(validated.status, 0, validated.stderr);
    assert.match(validated.stdout, /VALID/);
    const onboard = fs.readFileSync(path.join(customerRoot, ".claude/specode-workflows/onboard.md"), "utf8");
    assert.match(onboard, /관련도 확인 후 3점 이상/);
    assert.match(onboard, /전체를 다 딥하게 분석/);
    assert.match(onboard, /특정 부분만 지정해서 분석/);
    assert.match(onboard, /확정되기 전에는 8번/);
    for (const name of ["run-ai-tasks", "review-uw", "sync-specode", "onboard-asis"]) {
      assert.match(fs.readFileSync(path.join(customerRoot, `.claude/commands/${name}.md`), "utf8"), /\.claude\/commands\/specode\.md/);
    }
  } finally {
    await client.close();
    await server.close();
    // 테스트가 직접 만든 임시 고객 저장소 하나만 정리한다.
    assert.equal(path.dirname(customerRoot), path.resolve(os.tmpdir()));
    assert.ok(path.basename(customerRoot).startsWith("specode-command-test-"));
    fs.rmSync(customerRoot, { recursive: true });
  }
});
