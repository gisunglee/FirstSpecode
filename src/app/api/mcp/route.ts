/**
 * POST /api/mcp — MCP Streamable HTTP 엔드포인트
 *
 * 역할:
 *   - Claude Code 등 AI 클라이언트가 HTTP로 MCP 서버에 접근할 때 사용
 *   - Vercel 서버리스 환경에서 동작 (stateless 모드)
 *   - 매 요청마다 McpServer 인스턴스를 생성하고 도구를 등록
 *
 * 프로토콜:
 *   - MCP Streamable HTTP (JSON-RPC 2.0 over HTTP)
 *   - POST: JSON-RPC 요청 처리 (initialize, tools/list, tools/call 등)
 *   - GET:  SSE 스트림 (stateless 모드에서는 미지원 → 405)
 *   - DELETE: 세션 종료 (stateless 모드에서는 미지원 → 405)
 *
 * 사용법 (.mcp.json):
 *   {
 *     "mcpServers": {
 *       "specode": {
 *         "type": "url",
 *         "url": "https://your-app.vercel.app/api/mcp"
 *       }
 *     }
 *   }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "@/lib/mcp/register-tools";

// ─── POST: MCP JSON-RPC 요청 처리 ─────────────────────────────────
export async function POST(request: Request) {
  // JSON-RPC 요청 파싱
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null },
      { status: 400 }
    );
  }

  // 매 요청마다 서버 + 도구 등록 (stateless — Vercel 서버리스 호환)
  const server = new McpServer({
    name: "specode-mcp",
    version: "1.0.0",
  });
  registerTools(server);

  // stateless 트랜스포트 생성 (세션 ID 없음)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);

  // StreamableHTTPServerTransport.handleRequest는 Node.js req/res를 기대함
  // Next.js App Router의 Web API Request/Response를 어댑터로 변환
  const responseChunks: string[] = [];
  const responseHeaders: Record<string, string> = {};
  let statusCode = 200;

  const mockRes = {
    writeHead(code: number, headers?: Record<string, string>) {
      statusCode = code;
      if (headers) Object.assign(responseHeaders, headers);
      return this;
    },
    write(chunk: string | Buffer) {
      responseChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    },
    end(data?: string | Buffer) {
      if (data) responseChunks.push(typeof data === "string" ? data : data.toString());
    },
    on() { return this; },
    once() { return this; },
    emit() { return false; },
    setHeader(name: string, value: string) { responseHeaders[name.toLowerCase()] = value; },
    getHeader(name: string) { return responseHeaders[name.toLowerCase()]; },
    headersSent: false,
    flushHeaders() {},
  };

  const mockReq = {
    method: "POST",
    headers: Object.fromEntries(request.headers.entries()),
    on() { return this; },
  };

  try {
    // parsedBody를 세 번째 인자로 전달 — 스트림 파싱 우회
    await transport.handleRequest(mockReq as any, mockRes as any, body);
  } catch (err) {
    console.error("[MCP] handleRequest error:", err);
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null },
      { status: 500 }
    );
  }

  // 응답 반환
  const responseBody = responseChunks.join("");
  return new Response(responseBody, {
    status: statusCode,
    headers: {
      "Content-Type": responseHeaders["content-type"] || "application/json",
    },
  });
}

// ─── GET, DELETE: stateless 모드에서는 미지원 ────────────────────
export async function GET() {
  return Response.json(
    { error: "SSE not supported in stateless mode. Use POST for MCP requests." },
    { status: 405 }
  );
}

export async function DELETE() {
  return Response.json(
    { error: "Session management not supported in stateless mode." },
    { status: 405 }
  );
}
