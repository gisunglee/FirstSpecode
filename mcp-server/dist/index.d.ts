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
export {};
