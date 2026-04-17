/**
 * index.ts — SPECODE MCP Server 엔트리 포인트
 *
 * 역할:
 *   - 환경변수 로드 (.env.local) 및 검증
 *   - McpServer 인스턴스 생성 및 도구 등록
 *   - Streamable HTTP 전송 계층 설정 (Express)
 *
 * 실행:
 *   npm run dev    — tsx watch 모드 (개발)
 *   npm run start  — tsx 직접 실행
 *
 * 엔드포인트:
 *   POST /mcp     — MCP Streamable HTTP (AI 클라이언트 연결용)
 *   GET  /health  — 헬스체크
 */
// dotenv — .env.local 파일에서 환경변수 로드
// import 최상단에서 실행해야 config.ts가 환경변수를 읽을 수 있음
// process.cwd()는 npm run dev/start 실행 시 mcp-server/ 디렉토리
import dotenv from "dotenv";
import { resolve } from "node:path";
dotenv.config({ path: resolve(process.cwd(), ".env.local") });
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { validateConfig, getMcpPort } from "./config.js";
import { registerTools } from "./register-tools.js";
// ─── 환경변수 검증 ──────────────────────────────────────────────
// 필수 환경변수 누락 시 여기서 프로세스 종료됨
validateConfig();
// ─── MCP 서버 팩토리 ────────────────────────────────────────────
/**
 * Stateless Streamable HTTP 모드 — 요청마다 새 McpServer 생성
 * (세션 상태를 유지할 필요가 없으므로 stateless로 충분)
 */
function createMcpServer() {
    const server = new McpServer({
        name: "specode-mcp",
        version: "1.0.0",
    });
    registerTools(server);
    return server;
}
// ─── Express 앱 설정 ────────────────────────────────────────────
const app = express();
app.use(express.json());
/**
 * POST /mcp — MCP Streamable HTTP 엔드포인트
 * AI 클라이언트(Claude Code 등)가 이 엔드포인트로 도구를 호출함
 */
app.post("/mcp", async (req, res) => {
    try {
        const server = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined, // stateless — 세션 ID 불필요
        });
        // 클라이언트 연결 종료 시 transport 정리
        res.on("close", () => {
            transport.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    }
    catch (err) {
        console.error("[MCP] 요청 처리 실패:", err);
        if (!res.headersSent) {
            res.status(500).json({ error: "MCP 서버 내부 오류" });
        }
    }
});
// GET, DELETE는 stateless 모드에서 불필요 → 405 반환
app.get("/mcp", (_req, res) => {
    res.status(405).json({ error: "Method Not Allowed — POST만 지원합니다" });
});
app.delete("/mcp", (_req, res) => {
    res.status(405).json({ error: "Method Not Allowed — POST만 지원합니다" });
});
/** GET /health — 서버 상태 확인용 */
app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: "specode-mcp", version: "1.0.0" });
});
// ─── 서버 기동 ──────────────────────────────────────────────────
app.listen(getMcpPort(), () => {
    console.log("");
    console.log("=".repeat(50));
    console.log("  SPECODE MCP Server 기동 완료");
    console.log(`  엔드포인트: http://localhost:${getMcpPort()}/mcp`);
    console.log(`  헬스체크:   http://localhost:${getMcpPort()}/health`);
    console.log("=".repeat(50));
    console.log("");
});
