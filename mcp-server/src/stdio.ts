/**
 * stdio.ts — SPECODE MCP Server stdio 엔트리 포인트
 *
 * 역할:
 *   - Claude Code 등 AI 클라이언트가 command 방식으로 MCP 서버에 연결할 때 사용
 *   - stdin/stdout을 통해 JSON-RPC 메시지를 주고받음
 *
 * 실행:
 *   npx tsx src/stdio.ts
 */

import dotenv from "dotenv";
import { resolve } from "node:path";

// mcp-server/ 디렉토리 기준으로 .env.local 로드
dotenv.config({ path: resolve(import.meta.dirname, "..", ".env.local") });

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { validateConfig } from "./config.js";
import { registerTools } from "./register-tools.js";

// 환경변수 검증
validateConfig();

// MCP 서버 생성 및 도구 등록
const server = new McpServer({
  name: "specode-mcp",
  version: "1.0.0",
});
registerTools(server);

// stdio transport로 연결
const transport = new StdioServerTransport();
await server.connect(transport);
