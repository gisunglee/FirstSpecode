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
/** SPECODE API 서버 base URL */
export declare function getBaseUrl(): string;
/** MCP 서버 포트 */
export declare function getMcpPort(): number;
/** SPECODE API 키 (spk_... 형식) — 설정되어 있으면 서비스 토큰보다 우선 사용 */
export declare function getApiKey(): string;
/** JWT 시크릿 — 서비스 토큰 자체 발급에 사용 (API 키 없을 때 fallback) */
export declare function getJwtSecret(): string;
/** 서비스 계정 회원 ID */
export declare function getServiceMberId(): string;
/** 서비스 계정 이메일 */
export declare function getServiceEmail(): string;
/**
 * 서버 기동 전 인증 환경변수 검증
 * — SPECODE_API_KEY 또는 (JWT_SECRET + SERVICE_MBER_ID + SERVICE_EMAIL) 중 하나 필수
 */
export declare function validateConfig(): void;
