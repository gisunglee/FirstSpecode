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
/** SPECODE API 서버 base URL */
export declare function getBaseUrl(): string;
/** MCP 서버 포트 */
export declare function getMcpPort(): number;
/** JWT 시크릿 — 서비스 토큰 자체 발급에 사용 */
export declare function getJwtSecret(): string;
/** 서비스 계정 회원 ID */
export declare function getServiceMberId(): string;
/** 서비스 계정 이메일 */
export declare function getServiceEmail(): string;
/**
 * 서버 기동 전 필수 환경변수 검증
 * — 누락 시 명확한 에러 메시지와 함께 프로세스 종료
 */
export declare function validateConfig(): void;
