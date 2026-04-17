/**
 * smoke.ts — MCP 도구 스모크 테스트
 *
 * 역할:
 *   - MCP 서버의 모든 도구가 API와 정상 통신하는지 검증
 *   - API 인터페이스 변경 시 MCP 도구가 깨지지 않았는지 확인
 *   - 조회(GET) 도구만 테스트 (생성/수정/삭제는 데이터에 영향이 가므로 제외)
 *
 * 실행:
 *   cd mcp-server && npx tsx test/smoke.ts
 *
 * 환경변수:
 *   .env.local에서 로드 (dotenv)
 */

import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "..", ".env.local") });

import { specodeFetch } from "../src/api-client.js";

// ─── 테스트 헬퍼 ─────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ❌ ${name} — ${msg}`);
    failed++;
  }
}

/** 응답 데이터에 특정 필드가 있는지 확인 */
function assertField(data: any, field: string) {
  if (data === null || data === undefined) {
    throw new Error(`응답이 null/undefined`);
  }
  if (!(field in data)) {
    throw new Error(`응답에 '${field}' 필드 없음. 받은 키: ${Object.keys(data).join(", ")}`);
  }
}

// ─── 테스트 실행 ─────────────────────────────────────────────────

const PROJECT_ID = "bbba8058-a48f-4dfb-a586-71e2d87be7a4";

console.log("\n🔍 MCP 스모크 테스트 시작\n");
console.log("── 프로젝트 ──────────────────────────────");

await test("list_projects", async () => {
  const data: any = await specodeFetch("/api/projects");
  assertField(data, "items");
});

await test("get_project", async () => {
  const data: any = await specodeFetch(`/api/projects/${PROJECT_ID}`);
  assertField(data, "projectId");
});

console.log("\n── 기획: 과업 ────────────────────────────");

let taskId: string | undefined;

await test("list_tasks", async () => {
  const data: any = await specodeFetch(`/api/projects/${PROJECT_ID}/tasks`);
  assertField(data, "tasks");
  if (data.tasks.length > 0) taskId = data.tasks[0].taskId;
});

await test("get_task", async () => {
  if (!taskId) throw new Error("테스트 데이터 없음 (과업이 0건)");
  const data: any = await specodeFetch(`/api/projects/${PROJECT_ID}/tasks/${taskId}`);
  assertField(data, "taskId");
});

console.log("\n── 기획: 요구사항 ────────────────────────");

let reqId: string | undefined;

await test("list_requirements", async () => {
  const data: any = await specodeFetch(`/api/projects/${PROJECT_ID}/requirements`);
  assertField(data, "items");
  if (data.items.length > 0) reqId = data.items[0].requirementId;
});

await test("get_requirement", async () => {
  if (!reqId) throw new Error("테스트 데이터 없음 (요구사항이 0건)");
  const data: any = await specodeFetch(`/api/projects/${PROJECT_ID}/requirements/${reqId}`);
  assertField(data, "requirementId");
});

console.log("\n── 기획: 사용자스토리 ────────────────────");

await test("list_user_stories", async () => {
  const data: any = await specodeFetch(`/api/projects/${PROJECT_ID}/user-stories`);
  assertField(data, "items");
});

console.log("\n── 기획: 트리 ────────────────────────────");

await test("get_planning_tree", async () => {
  const data: any = await specodeFetch(`/api/projects/${PROJECT_ID}/planning/tree`);
  assertField(data, "tasks");
});

console.log("\n── 설계: 단위업무 ────────────────────────");

let unitWorkId: string | undefined;

await test("list_unit_works", async () => {
  const data: any = await specodeFetch(`/api/projects/${PROJECT_ID}/unit-works`);
  assertField(data, "items");
  if (data.items.length > 0) unitWorkId = data.items[0].unitWorkId;
});

await test("get_unit_work", async () => {
  if (!unitWorkId) throw new Error("테스트 데이터 없음 (단위업무가 0건)");
  const data: any = await specodeFetch(`/api/projects/${PROJECT_ID}/unit-works/${unitWorkId}`);
  assertField(data, "unitWorkId");
});

console.log("\n── 설계: 화면 ────────────────────────────");

let screenId: string | undefined;

await test("list_screens", async () => {
  const data: any = await specodeFetch(`/api/projects/${PROJECT_ID}/screens`);
  assertField(data, "items");
  if (data.items.length > 0) screenId = data.items[0].screenId;
});

await test("get_screen", async () => {
  if (!screenId) throw new Error("테스트 데이터 없음 (화면이 0건)");
  const data: any = await specodeFetch(`/api/projects/${PROJECT_ID}/screens/${screenId}`);
  assertField(data, "screenId");
});

console.log("\n── 설계: 영역 ────────────────────────────");

let areaId: string | undefined;

await test("list_areas", async () => {
  const data: any = await specodeFetch(`/api/projects/${PROJECT_ID}/areas`);
  assertField(data, "items");
  if (data.items.length > 0) areaId = data.items[0].areaId;
});

await test("get_area", async () => {
  if (!areaId) throw new Error("테스트 데이터 없음 (영역이 0건)");
  const data: any = await specodeFetch(`/api/projects/${PROJECT_ID}/areas/${areaId}`);
  assertField(data, "areaId");
});

console.log("\n── 설계: 기능 ────────────────────────────");

let functionId: string | undefined;

await test("list_functions", async () => {
  const data: any = await specodeFetch(`/api/projects/${PROJECT_ID}/functions`);
  assertField(data, "items");
  if (data.items.length > 0) functionId = data.items[0].functionId;
});

await test("get_function", async () => {
  if (!functionId) throw new Error("테스트 데이터 없음 (기능이 0건)");
  const data: any = await specodeFetch(`/api/projects/${PROJECT_ID}/functions/${functionId}`);
  assertField(data, "functionId");
});

console.log("\n── DB 테이블 ─────────────────────────────");

await test("list_db_tables", async () => {
  const data: any = await specodeFetch(`/api/projects/${PROJECT_ID}/db-tables`);
  // db-tables API는 items 또는 배열을 반환할 수 있음
  if (!data) throw new Error("응답이 비어있음");
});

// ─── 결과 요약 ───────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════");
console.log(`  결과: ${passed} passed, ${failed} failed (총 ${passed + failed})`);
console.log("══════════════════════════════════════════\n");

process.exit(failed > 0 ? 1 : 0);
