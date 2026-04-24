/**
 * designTemplate — 설계 양식 공용 유틸 + React Query 훅
 *
 * 역할:
 *   - 5계층 상세 페이지(요구사항·단위업무·화면·영역·기능)에서 "예시/템플릿 삽입"
 *     버튼이 공통으로 쓰는 DB 조회와 플레이스홀더 치환 로직을 한곳에 모음.
 *
 * 사용:
 *   const { data } = useDesignTemplate(projectId, "SCREEN");
 *   if (data) {
 *     // 예시 팝업
 *     setExampleOpen(true); // 팝업에서 data.exampleCn 사용
 *     // 템플릿 삽입
 *     setDescription(applyTemplateVars(data.templateCn, { displayId, name }));
 *   }
 */

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

// 설계 양식의 대상 계층 — API 라우트 입력값 검증에도 재사용
// (route 파일들이 각자 VALID_REF_TYPES를 재선언하던 중복 제거)
export const DESIGN_REF_TYPES = ["REQUIREMENT", "UNIT_WORK", "SCREEN", "AREA", "FUNCTION"] as const;
export type DesignRefType = (typeof DESIGN_REF_TYPES)[number];

/** /resolve 응답 타입 */
export type ResolvedDesignTemplate = {
  dsgnTmplId: string;
  isSystem:   boolean;
  refTyCode:  DesignRefType;
  tmplNm:     string;
  exampleCn:  string;
  templateCn: string;
};

/**
 * 템플릿 본문의 플레이스홀더({{displayId}}, {{name}})를 실제 값으로 치환.
 *
 * 신뢰 경계: 템플릿 본문은 운영자가 관리 UI에서 작성한 마크다운이므로 신뢰 가능.
 * XSS는 렌더 단계(marked + CSS scope)에서 처리하므로 여기선 단순 replaceAll.
 */
export function applyTemplateVars(
  template: string,
  vars: { displayId?: string | null; name?: string | null },
): string {
  return template
    .replaceAll("{{displayId}}", vars.displayId ?? "")
    .replaceAll("{{name}}",      vars.name      ?? "");
}

/**
 * 해당 계층의 "현재 프로젝트에서 활성인 설계 양식" 1건을 조회하는 React Query 훅.
 *
 * - 프로젝트 전용 양식이 있으면 그것이, 없으면 시스템 공통이 선택됨 (서버 /resolve 책임).
 * - staleTime 5분: 양식은 자주 바뀌지 않으므로 과도한 refetch 방지.
 * - 결과가 null이면 해당 계층에 어떤 양식도 없음 — 버튼 disabled 처리.
 */
export function useDesignTemplate(projectId: string, refType: DesignRefType) {
  return useQuery({
    queryKey: ["design-template", projectId, refType],
    queryFn: () =>
      authFetch<{ data: ResolvedDesignTemplate | null }>(
        `/api/projects/${projectId}/design-templates/resolve?refType=${refType}`,
      ).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    enabled:   !!projectId,
  });
}
