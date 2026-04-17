/**
 * config.ts — MCP 서버 환경변수 로드
 *
 * 역할:
 *   - SPECODE API 서버 URL, MCP 포트, 인증 정보를 환경변수에서 읽음
 *   - 필수값 누락 시 서버 기동 단계에서 즉시 에러를 발생시킴
 *
 * 인증 방식 (둘 중 하나):
 *   1. API 키 방식: SPECODE_API_KEY (권장 — 사용자별 키 발급)
 *   2. 서비스 토큰 방식: JWT_SECRET + SERVICE_MBER_ID + SERVICE_EMAIL (레거시)
 *
 * 환경변수:
 *   SPECODE_BASE_URL — SPECODE Next.js 서버 URL (기본: http://localhost:3000)
 *   MCP_PORT         — MCP 서버 포트 (기본: 3002)
 *   SPECODE_API_KEY  — SPECODE API 키 (spk_... 형식, 프로필에서 발급)
 *   JWT_SECRET       — JWT 서명 키 (서비스 토큰 방식 — SPECODE_API_KEY 없을 때 fallback)
 *   SERVICE_MBER_ID  — 서비스 계정 회원 ID (서비스 토큰 방식)
 *   SERVICE_EMAIL    — 서비스 계정 이메일 (서비스 토큰 방식)
 */
// ─── 환경변수 접근 함수 ─────────────────────────────────────────
/** SPECODE API 서버 base URL */
export function getBaseUrl() {
    return process.env.SPECODE_BASE_URL || "http://localhost:3000";
}
/** MCP 서버 포트 */
export function getMcpPort() {
    return parseInt(process.env.MCP_PORT || "3002", 10);
}
/** SPECODE API 키 (spk_... 형식) — 설정되어 있으면 서비스 토큰보다 우선 사용 */
export function getApiKey() {
    return process.env.SPECODE_API_KEY || "";
}
/** JWT 시크릿 — 서비스 토큰 자체 발급에 사용 (API 키 없을 때 fallback) */
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
 * 서버 기동 전 인증 환경변수 검증
 * — SPECODE_API_KEY 또는 (JWT_SECRET + SERVICE_MBER_ID + SERVICE_EMAIL) 중 하나 필수
 */
export function validateConfig() {
    const hasApiKey = !!getApiKey();
    const hasServiceToken = !!getJwtSecret() && !!getServiceMberId() && !!getServiceEmail();
    if (!hasApiKey && !hasServiceToken) {
        console.error(`[MCP Server] 인증 환경변수 누락.\n` +
            `다음 중 하나를 .env.local에 설정해 주세요:\n` +
            `  1. SPECODE_API_KEY=spk_...  (권장)\n` +
            `  2. JWT_SECRET + SERVICE_MBER_ID + SERVICE_EMAIL  (레거시)`);
        process.exit(1);
    }
}
