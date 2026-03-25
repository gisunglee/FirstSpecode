/**
 * useMyRole — 현재 프로젝트에서 내 역할 조회 훅 (UW-00011)
 *
 * 역할:
 *   - TanStack Query로 역할 캐싱 (staleTime 5분)
 *   - projectId가 없으면 쿼리 비활성화
 *   - UI 권한 제어 헬퍼 함수 제공
 *
 * 사용 예:
 *   const { myRole, canEdit, canManageMembers } = useMyRole(projectId);
 */

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

export type RoleCode =
  | "OWNER"
  | "ADMIN"
  | "PM"
  | "DESIGNER"
  | "DEVELOPER"
  | "VIEWER"
  | "MEMBER";

// 역할 계층: 높을수록 권한 많음
const ROLE_RANK: Record<RoleCode, number> = {
  OWNER:     6,
  ADMIN:     5,
  PM:        4,
  DESIGNER:  3,
  DEVELOPER: 3,
  MEMBER:    2,
  VIEWER:    1,
};

export function useMyRole(projectId: string | null) {
  const { data, isLoading } = useQuery({
    queryKey: ["my-role", projectId],
    queryFn: () =>
      authFetch<{ data: { myRole: RoleCode } }>(
        `/api/projects/${projectId}/my-role`
      ).then((r) => r.data.myRole),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000, // 5분 캐싱 — 역할은 자주 바뀌지 않음
  });

  const myRole = data ?? null;

  return {
    myRole,
    isLoading,

    // 생성·수정·삭제 가능 (VIEWER 제외)
    canEdit: myRole !== null && myRole !== "VIEWER",

    // 멤버 관리 (OWNER/ADMIN만)
    canManageMembers: myRole === "OWNER" || myRole === "ADMIN",

    // 프로젝트 설정 접근 (OWNER/ADMIN만 — 편집 목적)
    canAccessSettings: myRole === "OWNER" || myRole === "ADMIN",

    // 프로젝트 삭제 (OWNER만)
    canDeleteProject: myRole === "OWNER",

    // AI 요청 (VIEWER 제외)
    canRequestAI: myRole !== null && myRole !== "VIEWER",

    // 역할 수치 비교 유틸
    roleRank: myRole ? (ROLE_RANK[myRole] ?? 0) : 0,
  };
}
