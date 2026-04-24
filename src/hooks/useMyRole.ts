/**
 * useMyRole / usePermissions — 프론트 권한 훅 (역할 + 직무 + 플랜)
 *
 * 역할:
 *   - 현재 프로젝트 멤버십(role/job)과 계정 플랜(plan)을 함께 조회·캐시
 *   - permissions.ts의 PERMISSIONS 매트릭스를 그대로 사용해 `has(perm)` 제공
 *   - projectId 없으면 쿼리 비활성화 (모든 권한 false)
 *
 * 백엔드와 동일한 규칙(역할 OR 직무) 을 프론트에서도 쓰기 위해
 * `has()` 는 반드시 permissions.ts 의 hasPermission 을 거칩니다.
 *
 * 호환성:
 *   - 기존 useMyRole 반환값(canEdit, canManageMembers...)은 유지
 *   - 신규 코드는 usePermissions 를 쓰는 걸 권장
 *
 * 설계 문서: src/lib/permissions.md
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import {
  hasPermission,
  type ActorContext,
  type RoleCode,
  type JobCode,
  type PlanCode,
  type Permission,
} from "@/lib/permissions";

// ─── 서버 응답 타입 ──────────────────────────────────────────────────────────
// /api/projects/{projectId}/my-role 의 응답 계약
// 기존 { myRole } 만 오는 응답을 { myRole, myJob, myPlan } 으로 확장 예정
type MyRoleResponse = {
  myRole: RoleCode;
  myJob:  JobCode;   // 미지정 시 "ETC"
  myPlan: PlanCode;  // 계정 플랜 (FREE/PRO/TEAM/ENTERPRISE)
};

// /api/member/profile 에서 시스템 관리자 여부만 뽑아 쓰는 최소 타입.
// GNB 가 동일 queryKey(["member","profile"])로 이미 캐시하고 있으므로
// 프로필 재조회 없이 공유된다.
type MinimalProfile = {
  isSystemAdmin?: boolean;
};

// ─── 시스템 관리자 여부 훅 ───────────────────────────────────────────────────
// 프로젝트 무관. GNB/LNB 에서 /admin 메뉴 노출 판별용.
export function useIsSystemAdmin(): { isSystemAdmin: boolean; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ["member", "profile"],
    queryFn: () =>
      authFetch<{ data: MinimalProfile }>("/api/member/profile").then((r) => r.data),
    staleTime: 5 * 60 * 1000, // 5분 — 시스템 역할은 거의 안 바뀜
  });
  return {
    isSystemAdmin: data?.isSystemAdmin === true,
    isLoading,
  };
}

// ─── 메인 훅 ─────────────────────────────────────────────────────────────────

export function usePermissions(projectId: string | null) {
  const { data, isLoading } = useQuery({
    queryKey: ["my-role", projectId],
    queryFn: () =>
      authFetch<{ data: MyRoleResponse }>(
        `/api/projects/${projectId}/my-role`
      ).then((r) => r.data),
    enabled: !!projectId,
    staleTime: 60 * 1000, // 1분 캐싱 — 역할은 자주 바뀌지 않음
  });

  // 시스템 관리자 여부 — 프로젝트 단위가 아닌 전역 값.
  // 동일 queryKey 캐시 공유이므로 추가 네트워크 호출 없음.
  const { isSystemAdmin } = useIsSystemAdmin();

  // actor 객체 — hasPermission 에 그대로 전달
  const actor: ActorContext = useMemo(
    () => ({
      role: data?.myRole ?? null,
      job:  data?.myJob  ?? null,
      plan: data?.myPlan ?? "FREE",
      systemRole: isSystemAdmin ? "SUPER_ADMIN" : null,
    }),
    [data, isSystemAdmin]
  );

  // has(perm) — 단일 권한 체크
  const has = useMemo(
    () => (perm: Permission) => hasPermission(actor, perm),
    [actor]
  );

  return {
    // 원본 값
    myRole: actor.role,
    myJob:  actor.job,
    myPlan: actor.plan,
    isSystemAdmin,
    isLoading,

    // 단일 권한 체크 — 백엔드와 동일 로직
    has,

    // 자주 쓰는 편의 플래그 (하위 호환)
    canEdit:           has("content.update"),
    canRequestAI:      has("ai.request"),
    canManageMembers:  has("member.invite"),
    canAccessSettings: has("project.settings"),
    canDeleteProject:  has("project.delete"),
  };
}

// ─── 하위 호환 별칭 ──────────────────────────────────────────────────────────
// 기존 컴포넌트(LNB 등)는 useMyRole 을 그대로 쓸 수 있도록 별칭 유지
export const useMyRole = usePermissions;

// 기존 타입 재export — import { RoleCode } 호출부 호환
export type { RoleCode, JobCode, PlanCode } from "@/lib/permissions";
