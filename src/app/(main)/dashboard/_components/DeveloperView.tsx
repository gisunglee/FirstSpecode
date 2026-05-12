"use client";

/**
 * DeveloperView — 개발자뷰 (내 작업 중심 3개 카드)
 *
 * 데이터:
 *   GET /api/projects/[id]/dashboard/me-summary
 *   1차 릴리즈 카드 3종: 내 과업 / 마감 임박 / 내 AI 결과
 */

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import type { MeSummaryResponse } from "@/types/dashboard";

import MyTasksCard      from "./cards/MyTasksCard";
import MyDeadlinesCard  from "./cards/MyDeadlinesCard";
import MyAiResultsCard  from "./cards/MyAiResultsCard";
import MyReviewsCard    from "./cards/MyReviewsCard";

const STALE_TIME_MS = 5 * 60 * 1000;

type Props = { projectId: string };

export default function DeveloperView({ projectId }: Props) {
  const { data, isLoading, error } = useQuery<MeSummaryResponse>({
    queryKey: ["dashboard", "me", projectId],
    queryFn: () =>
      authFetch<{ data: MeSummaryResponse }>(
        `/api/projects/${projectId}/dashboard/me-summary`
      ).then((r) => r.data),
    enabled:   !!projectId,
    staleTime: STALE_TIME_MS,
  });

  // 카드 순서 — "마감 임박"이 가장 시급(좌상단), "내 과업"이 큰 그림,
  // "검토 요청"·"AI 결과"는 행동 필요 항목들.
  return (
    <div className="sp-dashboard-grid">
      <MyDeadlinesCard
        data={data?.myDeadlines}
        isLoading={isLoading}
        error={error as Error | null}
        projectId={projectId}
      />
      <MyTasksCard
        data={data?.myTasks}
        isLoading={isLoading}
        error={error as Error | null}
        projectId={projectId}
      />
      <MyReviewsCard
        data={data?.myReviews}
        isLoading={isLoading}
        error={error as Error | null}
        projectId={projectId}
      />
      <MyAiResultsCard
        data={data?.myAiResults}
        isLoading={isLoading}
        error={error as Error | null}
        projectId={projectId}
      />
    </div>
  );
}
