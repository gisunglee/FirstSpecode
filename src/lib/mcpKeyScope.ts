/**
 * mcpKeyScope — MCP 키의 프로젝트 scope 강제 헬퍼
 *
 * 역할:
 *   - "프로젝트 고정 MCP 키"(auth.allowedPrjctId 값 있음)가 다른 프로젝트를
 *     건드리려고 할 때 403으로 차단
 *   - JWT 인증 또는 전역 MCP 키는 그대로 통과 (allowedPrjctId가 undefined)
 *
 * 적용 위치:
 *   1) requirePermission 내부 — requireAuth 직후 scope 체크 (56개 라우트 자동 커버)
 *   2) requireAuth만 쓰는 프로젝트 라우트 — 수동 호출 (패턴 A 16개)
 *   3) 전역 목록 라우트(/api/projects, /api/projects/my) — filterByMcpKeyScope 로
 *      허용된 프로젝트만 반환되도록 필터링
 *
 * 설계 이유:
 *   한 사용자가 여러 프로젝트 멤버일 때 Claude Code 세션이 실수로 다른
 *   프로젝트를 건드리는 사고를 막기 위해 키 발급 시점에 프로젝트를 고정.
 *   내부 API 전체에 방어선을 치기 위해 requirePermission(주 경로) +
 *   이 헬퍼(보조 경로) 이중 배치.
 */

import { apiError } from "@/lib/apiResponse";
import type { AuthPayload } from "@/lib/requireAuth";

/**
 * 전역 키를 의미하는 sentinel 값.
 *
 * NULL이 아니라 명시적 문자열을 쓰는 이유 (fail-secure):
 *   - NULL은 "값이 없다"의 기본값으로 코드 누락/버그로 쉽게 들어감
 *   - "NULL = 전역 권한"이면 실수로 NULL이 INSERT되었을 때 최상위 권한이 부여됨
 *   - 명시적 sentinel 'ALL' + NOT NULL 제약으로 "생성자가 의도적으로 전역"을 선언하도록 강제
 *   - prjct_id 컬럼은 NOT NULL이라 누락 시 DB가 거부 → "default to most permissive" 방지
 *
 * 코드에서는 이 상수만 참조 — 하드코딩된 'ALL' 문자열 금지.
 */
export const MCP_KEY_GLOBAL_SCOPE = "ALL" as const;

/** prjct_id 컬럼 값이 전역 키인지 판단 */
export function isGlobalMcpKey(prjctId: string): boolean {
  return prjctId === MCP_KEY_GLOBAL_SCOPE;
}

/**
 * 프로젝트 단위 scope 검증
 *
 * @param auth      requireAuth 반환 payload
 * @param projectId 접근 대상 프로젝트 ID
 * @returns         scope 불일치 시 403 Response, 통과 시 null
 *
 * 사용 예:
 *   const auth = await requireAuth(request);
 *   if (auth instanceof Response) return auth;
 *   const scopeErr = enforceMcpKeyScope(auth, projectId);
 *   if (scopeErr) return scopeErr;
 */
export function enforceMcpKeyScope(
  auth: AuthPayload,
  projectId: string
): Response | null {
  // 전역 키 또는 JWT 인증 — 검증 생략
  if (!auth.allowedPrjctId) return null;

  // 프로젝트 고정 키인데 대상이 다르면 차단
  if (auth.allowedPrjctId !== projectId) {
    return apiError(
      "FORBIDDEN_SCOPE",
      "이 API 키는 다른 프로젝트 전용입니다. 해당 프로젝트의 키를 사용해 주세요.",
      403
    );
  }

  return null;
}

/**
 * Prisma where 조건에 scope 필터를 병합
 *
 * 전역 키면 빈 객체 반환(필터 없음), scope 키면 { prjct_id: X } 반환.
 * 목록 API에서 `where: { ...base, ...scopeWhere(auth) }` 형태로 사용.
 *
 * @param auth  requireAuth 반환 payload
 * @returns     병합용 where 부분 객체
 */
export function scopeWhere(auth: AuthPayload): { prjct_id?: string } {
  if (!auth.allowedPrjctId) return {};
  return { prjct_id: auth.allowedPrjctId };
}
