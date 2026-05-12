"use client";

/**
 * useActivityFeed — 무한 스크롤 활동 피드 훅
 *
 * 역할:
 *   - TanStack Query useInfiniteQuery 래핑
 *   - 페이지별로 이벤트 누적, nextCursor 따라 자동 종료
 *   - 기간/프로젝트 변경 시 자동 무효화
 *
 * 격리:
 *   - dashboard 의 5분 staleTime 과 다르게, 활동은 좀 더 신선해야 하므로 60초
 */

import { useInfiniteQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import type { ActivityFeedResponse, ActivityRangeKey } from "@/types/activity";

const STALE_TIME_MS = 60 * 1000;

export function useActivityFeed(projectId: string | null, range: ActivityRangeKey) {
  return useInfiniteQuery<ActivityFeedResponse>({
    // 기간 변경 시 캐시 분리 — 다시 처음부터 로드
    queryKey: ["activity", projectId, range],
    enabled:  !!projectId,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ range });
      // cursor 가 있으면 그 이전 페이지 요청
      if (pageParam) params.set("cursor", String(pageParam));
      const url = `/api/projects/${projectId}/activity?${params.toString()}`;
      return authFetch<{ data: ActivityFeedResponse }>(url).then((r) => r.data);
    },
    // nextCursor null 이면 더 이상 페이지 없음
    getNextPageParam: (last) => last.nextCursor,
    staleTime: STALE_TIME_MS,
  });
}
