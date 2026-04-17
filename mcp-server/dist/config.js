/**
 * config.ts — MCP 서버 환경변수 로드
 *
 * 역할:
 *   - SPECODE API 서버 URL, MCP 포트, JWT 시크릿 등을 환경변수에서 읽음
 *   - 필수값 누락 시 서버 기동 단계에서 즉시 에러를 발생시킴
 *
 * 주의:
 *   - ESM에서는 import 시점에 process.env가 아직 세팅 안 됐을 수 있으므로
 *     환경변수 읽기는 함수 호출 시점까지 지연(lazy)시킴
 *
 * 환경변수:
 *   SPECODE_BASE_URL — SPECODE Next.js 서버 URL (기본: http://localhost:3001)
 *   MCP_PORT         — MCP 서버 포트 (기본: 3002)
 *   JWT_SECRET       — JWT 서명 키 (SPECODE와 동일한 값)
 *   SERVICE_MBER_ID  — 서비스 계정 회원 ID (개발용)
 *   SERVICE_EMAIL    — 서비스 계정 이메일 (개발용)
 */
// ─── 환경변수 접근 함수 ─────────────────────────────────────────
/** SPECODE API 서버 base URL */
export function getBaseUrl() {
    return process.env.SPECODE_BASE_URL || "http://localhost:3001";
}
/** MCP 서버 포트 */
export function getMcpPort() {
    return parseInt(process.env.MCP_PORT || "3002", 10);
}
/** JWT 시크릿 — 서비스 토큰 자체 발급에 사용 */
export function getJwtSecret() {
    return process.env.JWT_SECRET || "";
}
/** 서비스 계정 회원 ID */
export function getServiceMberId() {
    return process.env.SERVICE_MBER_ID || "";
}
/** 서비스 계정 이메일 */
export function getServiceEmail() {
    return process.env.SERVICE_EMAIL || "";
}
// ─── 유효성 검증 ─────────────────────────────────────────────────
/**
 * 서버 기동 전 필수 환경변수 검증
 * — 누락 시 명확한 에러 메시지와 함께 프로세스 종료
 */
export function validateConfig() {
    const missing = [];
    if (!getJwtSecret())
        missing.push("JWT_SECRET");
    if (!getServiceMberId())
        missing.push("SERVICE_MBER_ID");
    if (!getServiceEmail())
        missing.push("SERVICE_EMAIL");
    if (missing.length > 0) {
        console.error(`[MCP Server] 필수 환경변수 누락: ${missing.join(", ")}\n` +
            `.env.local 파일을 확인해 주세요.`);
        process.exit(1);
    }
}
