/**
 * apiResponse / apiError — API Route 응답 헬퍼
 *
 * 역할:
 *   - 모든 API Route에서 동일한 응답 구조를 보장
 *   - 성공/실패 응답을 한 곳에서 관리 (변경 시 파일 하나만 수정)
 *
 * 응답 구조:
 *   성공: { data: T }
 *   실패: { code: string, message: string }
 *
 * 사용 예:
 *   return apiSuccess({ id: 1, name: "홍길동" });
 *   return apiError("NOT_FOUND", "사용자를 찾을 수 없습니다.", 404);
 */

import { NextResponse } from "next/server";

// ─── 성공 응답 ────────────────────────────────────────────────────────────────

export function apiSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data }, { status });
}

// ─── 에러 응답 ────────────────────────────────────────────────────────────────

/**
 * @param code    - 에러 코드 (클라이언트에서 조건 분기 시 사용)
 * @param message - 사용자에게 표시할 메시지
 * @param status  - HTTP 상태 코드 (400, 401, 404, 500 등)
 * @param extra   - 응답 본문에 병합될 부가 정보 (예: rate limit의 retryAfter)
 * @param headers - 추가 응답 헤더 (예: 429 시 Retry-After)
 */
export function apiError(
  code: string,
  message: string,
  status = 500,
  extra?: Record<string, unknown>,
  headers?: Record<string, string>
): NextResponse {
  return NextResponse.json(
    { code, message, ...(extra ?? {}) },
    { status, ...(headers ? { headers } : {}) }
  );
}
