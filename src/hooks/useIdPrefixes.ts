/**
 * useIdPrefixes — 프로젝트 표시 ID prefix 7종 조회 hook
 *
 * 역할:
 *   - 신규 등록 화면의 표시 ID placeholder 에 사용할 prefix 를 받아온다.
 *   - 7개 prefix 를 한 번에 조회·캐시 (staleTime 5분).
 *
 * 사용 예:
 *   const { prefixes, getPrefix } = useIdPrefixes(projectId);
 *   placeholder={`${getPrefix("AREA")}-XXXXX (미 입력 시 자동 생성)`}
 *
 * 미로딩/실패 시 동작:
 *   - 환경설정 조회가 끝나지 않았거나 실패해도 fallback 하드코딩 prefix 를 반환.
 *   - 결과: 첫 렌더부터 placeholder 가 깨끗하게 표시되며, 환경설정이 다른 값이면
 *     캐시 도착 후 자연스럽게 새 값으로 교체됨.
 */

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

export type EntityKind =
  | "REQUIREMENT"
  | "USER_STORY"
  | "TASK"
  | "UNIT_WORK"
  | "SCREEN"
  | "AREA"
  | "FUNCTION";

type PrefixMap = Record<EntityKind, string>;

// 환경설정 조회 전/실패 시 즉시 사용할 fallback — idPrefix.ts 와 동일하게 유지
const FALLBACK: PrefixMap = {
  REQUIREMENT: "REQ",
  USER_STORY: "STR",
  TASK: "SFR",
  UNIT_WORK: "UW",
  SCREEN: "SCR",
  AREA: "AR",
  FUNCTION: "FN",
};

export function useIdPrefixes(projectId: string) {
  const { data } = useQuery<PrefixMap>({
    queryKey: ["id-prefixes", projectId],
    queryFn: () =>
      authFetch<{ data: PrefixMap }>(`/api/projects/${projectId}/id-prefixes`)
        .then((r) => r.data),
    // prefix 변경은 자주 일어나지 않으므로 5분 캐시 — 환경설정 페이지에서
    // 변경 시 invalidateQueries(["id-prefixes", projectId]) 로 갱신 가능.
    staleTime: 5 * 60_000,
  });

  const prefixes: PrefixMap = data ?? FALLBACK;

  return {
    prefixes,
    getPrefix(kind: EntityKind): string {
      return prefixes[kind];
    },
  };
}
