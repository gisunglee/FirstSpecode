/**
 * api-client.ts — SPECODE API 호출 클라이언트
 *
 * 역할:
 *   - SPECODE Next.js API 서버에 HTTP 요청을 보냄
 *   - JWT 서비스 토큰을 자동 생성하여 Authorization 헤더에 포함
 *   - 에러 발생 시 명확한 메시지로 래핑
 *
 * 주의:
 *   - 서비스 토큰은 매 요청마다 발급 (1시간 유효 — 캐싱 불필요)
 *   - SPECODE API 응답 형식: { data: T } (성공), { code, message } (에러)
 */
/**
 * SPECODE API 호출 래퍼
 * — 서비스 토큰 자동 포함, 에러 시 명확한 메시지 throw
 *
 * @param path  API 경로 (예: "/api/projects")
 * @param init  fetch 옵션 (method, body 등)
 * @returns     응답의 data 필드 (apiSuccess 래핑 해제)
 */
export declare function specodeFetch<T = unknown>(path: string, init?: RequestInit): Promise<T>;
