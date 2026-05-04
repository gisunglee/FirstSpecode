/**
 * useCanEditTask — 과업 등록/수정/삭제 가능 여부 (프론트 게이트)
 *
 * 백엔드 src/lib/taskWriteGate.ts 와 동일한 규칙:
 *   ① OWNER/ADMIN 역할 OR PM/PL 직무 (= "requirement.update" 매트릭스)
 *   ② 본인이 해당 과업의 담당자 (편집 모드에서만, 호출부에서 isAssignee 전달)
 *   ③ MEMBER 역할 + 환경설정 MEMBER_TASK_UPT_PSBL_YN === "Y"
 *
 * 신규 등록(isNew) 또는 목록의 "+ 과업 추가" 버튼은 ②(담당자)가 의미 없으므로
 * isAssignee 를 그냥 false 로 두면 됨.
 *
 * 백엔드와 항상 동기화 — 백엔드 gate 규칙이 바뀌면 이 훅도 함께 수정할 것.
 */

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { usePermissions } from "@/hooks/useMyRole";

const TASK_MEMBER_EDIT_KEY = "MEMBER_TASK_UPT_PSBL_YN";

type ConfigsResponse = {
  groups: Array<{ items: Array<{ key: string; value: string }> }>;
};

export function useCanEditTask(projectId: string, opts?: { isAssignee?: boolean }) {
  const { has, myRole, isLoading: roleLoading } = usePermissions(projectId);

  // configs 페이지/공통코드와 동일 queryKey — 캐시 공유
  const { data: configs, isLoading: configLoading } = useQuery({
    queryKey: ["configs", projectId],
    queryFn:  () =>
      authFetch<{ data: ConfigsResponse }>(
        `/api/projects/${projectId}/configs`
      ).then((r) => r.data),
    enabled: !!projectId,
    staleTime: 60 * 1000,
  });

  const memberEditEnabled = (() => {
    for (const g of configs?.groups ?? []) {
      for (const it of g.items) {
        if (it.key === TASK_MEMBER_EDIT_KEY) return it.value === "Y";
      }
    }
    return false;
  })();

  const matrixOK = has("requirement.update");
  const memberOK = myRole === "MEMBER" && memberEditEnabled;
  const isAssignee = !!opts?.isAssignee;

  return {
    /** 과업 편집/삭제 가능 — 매트릭스 OR 본인 담당 OR 멤버+옵트인 */
    canEditTask:   matrixOK || isAssignee || memberOK,
    /** 과업 신규 등록 가능 — 매트릭스 OR 멤버+옵트인 (담당자 조건은 무관) */
    canCreateTask: matrixOK || memberOK,
    /** 환경설정 옵트인 활성 여부 — 안내 문구 등에 사용 */
    memberEditEnabled,
    isLoading: roleLoading || configLoading,
  };
}
