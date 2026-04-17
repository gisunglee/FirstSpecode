/**
 * api-client.ts — SPECODE API 호출 클라이언트
 *
 * 역할:
 *   - SPECODE Next.js API 서버에 HTTP 요청을 보냄
 *   - 인증: API 키(spk_...) 우선, 없으면 JWT 서비스 토큰 fallback
 *   - 에러 발생 시 명확한 메시지로 래핑
 *
 * 인증 우선순위:
 *   1. SPECODE_API_KEY 환경변수 → API 키 그대로 전달
 *   2. JWT_SECRET + SERVICE_MBER_ID + SERVICE_EMAIL → JWT 서비스 토큰 발급
 */
/**
 * SPECODE API 호출 래퍼
 * — 인증 토큰 자동 포함, 에러 시 명확한 메시지 throw
 *
 * @param path  API 경로 (예: "/api/projects")
 * @param init  fetch 옵션 (method, body 등)
 * @returns     응답의 data 필드 (apiSuccess 래핑 해제)
 */
export declare function specodeFetch<T = unknown>(path: string, init?: RequestInit): Promise<T>;
