/**
 * /api/mcp — MCP Streamable HTTP 엔드포인트 (Vercel 공식 mcp-handler 기반)
 *
 * 역할:
 *   - Claude Code 등 AI 클라이언트가 HTTP로 MCP에 접속할 때 사용
 *   - Vercel 서버리스 / 로컬 Next.js 모두에서 동작
 *   - mcp-handler가 MCP 프로토콜(initialize/tools/list/tools/call) 자동 처리
 *
 * 보안 모델 (지난 턴에서 구축 — 유지):
 *   1. 1차 게이트(이 route) — requireAuth로 요청자 검증 (spk_ 또는 JWT AT)
 *   2. 토큰 전파 — 검증된 토큰을 내부 API 호출 시 그대로 릴레이 (api-client.ts)
 *   3. URL scope 가드 — requireAuth 안에서 프로젝트 고정 키가 다른 프로젝트
 *      건드리려고 하면 403 FORBIDDEN_SCOPE 즉시 반환
 *
 * 프로토콜:
 *   - MCP Streamable HTTP (JSON-RPC 2.0 over HTTP)
 *   - 단일 핸들러가 GET/POST/DELETE 모두 처리 (SSE/세션 포함, stateless 자동 동작)
 *
 * 사용법 (.mcp.json):
 *   {
 *     "mcpServers": {
 *       "specode": {
 *         "type": "http",
 *         "url": "http://localhost:3000/api/mcp",
 *         "headers": { "Authorization": "Bearer spk_발급받은_키" }
 *       }
 *     }
 *   }
 */

import { NextRequest } from "next/server";
import { createMcpHandler } from "mcp-handler";
import { registerTools } from "@/lib/mcp/register-tools";
import { createSpecodeFetch } from "@/lib/mcp/api-client";
import { requireAuth } from "@/lib/requireAuth";

// ─── 핸들러 팩토리 ─────────────────────────────────────────────
// mcp-handler의 serverSetup 콜백은 요청당 호출되므로 여기서 요청 스코프
// specodeFetch를 주입 → 각 호출이 "요청자 토큰"으로 내부 API를 불러
// "이 사용자가 멤버인 프로젝트"만 자동 접근되도록 함.
function buildHandler(bearerToken: string) {
  return createMcpHandler(
    (server) => {
      const specodeFetch = createSpecodeFetch({ token: bearerToken });
      registerTools(server, specodeFetch);
    },
    {
      // 서버 정보
      serverInfo: {
        name:    "specode-mcp",
        version: "1.0.0",
      },
    },
    {
      // 기본 경로 — /api 하위 모든 MCP 요청을 이 핸들러로 라우팅
      basePath: "/api",
    }
  );
}

// ─── 공통 진입점 — 인증 검증 후 mcp-handler에 위임 ───────────────
async function gateAndDispatch(request: NextRequest): Promise<Response> {
  // 1차 게이트 — Authorization 헤더 검증 + URL 기반 scope 체크
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;  // 401 / 403 FORBIDDEN_SCOPE

  // 여기 도달 시 Authorization: Bearer ... 헤더가 검증됨
  const bearerToken = request.headers.get("Authorization")!.slice("Bearer ".length);

  // 요청 스코프 핸들러로 위임 (토큰을 specodeFetch에 주입)
  const handler = buildHandler(bearerToken);
  return handler(request);
}

// Streamable HTTP는 한 엔드포인트가 GET/POST/DELETE 모두 처리.
//   - POST    : JSON-RPC 요청 (initialize, tools/list, tools/call 등)
//   - GET     : SSE 스트림 (세션 필요한 경우)
//   - DELETE  : 세션 종료
// stateless 모드면 내부적으로 SSE/세션 생략되고 단순 요청-응답으로 동작.
export async function GET(request: NextRequest)    { return gateAndDispatch(request); }
export async function POST(request: NextRequest)   { return gateAndDispatch(request); }
export async function DELETE(request: NextRequest) { return gateAndDispatch(request); }
