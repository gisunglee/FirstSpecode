/**
 * checkRole — API Route 역할 검증 헬퍼 (UW-00011)
 *
 * 역할:
 *   - API Route에서 역할 검증을 한 줄로 처리
 *   - 검증 실패 시 403 Response 반환 (반환값이 Response이면 즉시 return)
 *
 * 사용 예:
 *   const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN"]);
 *   if (roleCheck) return roleCheck; // 403
 *
 * 권한 정의 (PRD UW-00011):
 *   - 전체 읽기:        모든 역할
 *   - 생성·수정·삭제:   OWNER, ADMIN, PM, DESIGNER, DEVELOPER
 *   - AI 요청:         OWNER, ADMIN, PM, DESIGNER, DEVELOPER
 *   - 멤버 관리:        OWNER, ADMIN
 *   - 프로젝트 삭제:    OWNER
 */

import { apiError } from "@/lib/apiResponse";

// 역할 그룹 상수 — 사용 시 ROLES.EDIT처럼 참조
export const ROLES = {
  // 읽기 전용 이상 (전체)
  ALL:            ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER", "VIEWER", "MEMBER"] as const,
  // 생성·수정·삭제·AI 요청 가능
  EDIT:           ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"] as const,
  // 멤버 관리
  MANAGE_MEMBERS: ["OWNER", "ADMIN"] as const,
  // 프로젝트 삭제
  DELETE_PROJECT: ["OWNER"] as const,
} as const;

type AllowedRoles = readonly string[];

/**
 * 역할이 허용 목록에 없으면 403 Response를 반환, 있으면 null 반환
 *
 * @param roleCode     - 현재 사용자의 역할 코드
 * @param allowedRoles - 허용할 역할 목록 (ROLES 상수 활용 권장)
 * @param message      - 403 메시지 (기본: "권한이 없습니다.")
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
