/**
 * 설계 양식 플레이스홀더 회귀 테스트.
 *
 * MCP가 자동 채번 전의 설명에 {{displayId}}를 그대로 전달하면 저장 API가 실제 표시 ID로
 * 치환할 수 있어야 한다. AI가 접두어만 남기는 회귀를 막기 위해 MCP 지침도 함께 검증한다.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  applyTemplateVars,
  DESIGN_TEMPLATE_MCP_PLACEHOLDER_GUIDANCE,
} from "../src/lib/templateVars";
import { registerTools } from "../src/lib/mcp/register-tools";
import type { SpecodeFetch } from "../src/lib/mcp/api-client";

test("화면 양식의 displayId와 name을 실제 값으로 치환한다", () => {
  const template = "## [{{displayId}}] {{name}}\n\n| 화면ID | {{displayId}} |";

  assert.equal(
    applyTemplateVars(template, {
      displayId: "SCR-00009",
      name: "국가 탄소중립 정책 관리",
    }),
    "## [SCR-00009] 국가 탄소중립 정책 관리\n\n| 화면ID | SCR-00009 |",
  );
});

test("영역과 기능 양식도 동일한 플레이스홀더 규칙으로 치환한다", () => {
  assert.equal(
    applyTemplateVars("### 영역: [{{displayId}}] {{name}}", {
      displayId: "AR-00019",
      name: "검색 영역",
    }),
    "### 영역: [AR-00019] 검색 영역",
  );
  assert.equal(
    applyTemplateVars("#### 기능: [{{displayId}}] {{name}}", {
      displayId: "FN-00017",
      name: "뎁스별 검색 콤보 조회",
    }),
    "#### 기능: [FN-00017] 뎁스별 검색 콤보 조회",
  );
});

test("MCP 지침은 자동 채번 시 토큰 보존과 접두어 축약 금지를 명시한다", () => {
  assert.match(DESIGN_TEMPLATE_MCP_PLACEHOLDER_GUIDANCE, /\{\{displayId\}\}/);
  assert.match(DESIGN_TEMPLATE_MCP_PLACEHOLDER_GUIDANCE, /문자 그대로 유지/);
  assert.match(DESIGN_TEMPLATE_MCP_PLACEHOLDER_GUIDANCE, /접두어만 남기거나 번호를 추측하지 마세요/);
  assert.match(DESIGN_TEMPLATE_MCP_PLACEHOLDER_GUIDANCE, /저장 API가 채번 후 실제 표시 ID로 치환/);
});

test("자동 채번 생성 도구와 설계 양식 조회 도구가 플레이스홀더 지침을 노출한다", () => {
  const descriptions = new Map<string, string>();
  const server = {
    tool(name: string, description: string) {
      descriptions.set(name, description);
    },
  } as unknown as McpServer;
  const specodeFetch = (async () => ({})) as SpecodeFetch;

  registerTools(server, specodeFetch);

  for (const toolName of [
    "create_requirement",
    "create_unit_work",
    "create_screen",
    "create_area",
    "create_function",
    "get_design_template",
  ]) {
    const description = descriptions.get(toolName);
    assert.ok(description, `${toolName} 설명이 등록되어야 합니다.`);
    assert.match(description, /\{\{displayId\}\}/, `${toolName}에 토큰 보존 지침이 필요합니다.`);
    assert.match(description, /접두어만 남기거나 번호를 추측하지 마세요/);
  }
});
