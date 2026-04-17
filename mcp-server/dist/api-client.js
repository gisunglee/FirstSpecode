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
import jwt from "jsonwebtoken";
import { getBaseUrl, getApiKey, getJwtSecret, getServiceMberId, getServiceEmail, } from "./config.js";
// ─── 인증 헤더 값 결정 ───────────────────────────────────────────
/**
 * Authorization 헤더에 넣을 토큰 값 반환
 * — API 키가 있으면 그대로, 없으면 JWT 서비스 토큰 발급
 */
function getAuthToken() {
    // API 키 우선 (spk_... 형식 그대로 전달)
    const apiKey = getApiKey();
    if (apiKey)
        return apiKey;
    // fallback: JWT 서비스 토큰 자체 발급
    return jwt.sign({ mberId: getServiceMberId(), email: getServiceEmail() }, getJwtSecret(), { expiresIn: "1h" });
}
// ─── API 호출 래퍼 ────────────────────────────────────────────────
/**
 * SPECODE API 호출 래퍼
 * — 인증 토큰 자동 포함, 에러 시 명확한 메시지 throw
 *
 * @param path  API 경로 (예: "/api/projects")
 * @param init  fetch 옵션 (method, body 등)
 * @returns     응답의 data 필드 (apiSuccess 래핑 해제)
 */
export async function specodeFetch(path, init) {
    const token = getAuthToken();
    const url = `${getBaseUrl()}${path}`;
    const res = await fetch(url, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...init?.headers,
        },
    });
    // 응답 본문 파싱 — JSON이 아닐 수도 있으므로 방어
    let body;
    try {
        body = (await res.json());
    }
    catch {
        throw new Error(`SPECODE API 응답 파싱 실패 (${res.status} ${res.statusText}) — ${url}`);
    }
    // HTTP 에러 응답 처리 — SPECODE 에러 형식: { code, message }
    if (!res.ok) {
        const code = body.code ?? "UNKNOWN";
        const message = body.message ?? `HTTP ${res.status}`;
        throw new Error(`[${code}] ${message}`);
    }
    // 성공 응답 — SPECODE 형식: { data: T }
    return (body.data ?? body);
}
