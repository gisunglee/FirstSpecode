/**
 * useCanEditTask — 과업 등록/수정/삭제 가능 여부 (프론트 게이트)
 *
 * 생성은 일반 content.create(MEMBER 이상), 수정은 서버가 내려주는 항목별 permissions를
 * 우선 사용한다. 이 훅의 수정값은 상세 응답을 아직 받기 전의 보수적 fallback이다.
 */

import { usePermissions } from "@/hooks/useMyRole";

export function useCanEditTask(projectId: string, opts?: { isAssignee?: boolean }) {
  const { has, myRole, isLoading } = usePermissions(projectId);

  const matrixOK = myRole !== "VIEWER" && has("requirement.update");
  const isAssignee = !!opts?.isAssignee;

  return {
    canEditTask: matrixOK || isAssignee,
    canCreateTask: has("content.create"),
    isLoading,
  };
}
