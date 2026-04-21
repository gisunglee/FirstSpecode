/**
 * checkRole — [DEPRECATED] 구 7-role 체계 잔존 헬퍼
 *
 * ⚠️ 신규 코드에선 사용 금지. 대신 다음을 사용:
 *     - 백엔드 API:  requirePermission()  @ src/lib/requirePermission.ts
 *     - 프론트:      usePermissions()     @ src/hooks/useMyRole.ts
 *     - 권한 매트릭스: PERMISSIONS        @ src/lib/permissions.ts
 *
 * 이 파일은 기존 호출부 이전 유예를 위해 남겨두며,
 * 모든 호출부가 permissions.ts 로 이전되면 삭제됩니다.
 * 새 4-role(OWNER/ADMIN/MEMBER/VIEWER)에서도 동작하도록
 * 구 코드(PM/DESIGNER/DEVELOPER)는 내부적으로 MEMBER 로 간주합니다.
 *
 * 설계 문서: src/lib/permissions.md
 */

import { apiError } from "@/lib/apiResponse";

// 역할 그룹 상수 — 구 7-role 호환 유지
// 신규 4-role 이관 후에도 동일 결과가 나오도록 MEMBER 포함
export const ROLES = {
  // 읽기 전용 이상 (전체)
  ALL:            ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER", "VIEWER", "MEMBER"] as const,
  // 생성·수정·삭제·AI 요청 가능 — 신규 체계에선 MEMBER 가 담당 (구 PM/DESIGNER/DEVELOPER 대체)
  EDIT:           ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER", "MEMBER"] as const,
  // 멤버 관리
  MANAGE_MEMBERS: ["OWNER", "ADMIN"] as const,
  // 프로젝트 삭제
  DELETE_PROJECT: ["OWNER"] as const,
} as const;

type AllowedRoles = readonly string[];

/**
 * @deprecated 신규 코드에선 requirePermission() 사용
 *
 * 역할이 허용 목록에 없으면 403 Response를 반환, 있으면 null 반환
 */
export function checkRole(
  roleCode: string,
  allowedRoles: AllowedRoles,
  message = "권한이 없습니다."
): Response | null {
  if (!(allowedRoles as readonly string[]).includes(roleCode)) {
    return apiError("FORBIDDEN", message, 403) as unknown as Response;
  }
  return null;
}
