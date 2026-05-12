"use client";

/**
 * ManageView — 관리뷰 (3개 카드 그리드)
 *
 * 역할:
 *   - manage-summary 단일 엔드포인트 호출 → 카드 3개에 분배
 *   - 카드 컴포넌트 자체에서 isLoading/error/empty 처리
 *
 * 데이터:
 *   GET /api/projects/[id]/dashboard/manage-summary
 *   1차 릴리즈 카드 3종: 진행률 / 정체된 일 / 최근 변경
 *
 * Phase 2 추가 카드(팀 활동, AI 사용 등)도 동일 엔드포인트에 필드를 추가해
 * 한 번의 라운드트립을 유지할 예정.
 */

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import type { ManageSummaryResponse } from "@/types/dashboard";

import ProgressCard       from "./cards/ProgressCard";
import StalledCard        from "./cards/StalledCard";
import RecentChangesCard  from "./cards/RecentChangesCard";
import TeamActivityCard   from "./cards/TeamActivityCard";
import AiUsageCard        from "./cards/AiUsageCard";

const STALE_TIME_MS = 5 * 60 * 1000; // 5분 — 대시보드는 실시간 정확성보다 빠른 표시 우선

type Props = { projectId: string };

export default function ManageView({ projectId }: Props) {
  const { data, isLoading, error } = useQuery<ManageSummaryResponse>({
    queryKey: ["dashboard", "manage", projectId],
    queryFn: () =>
      authFetch<{ data: ManageSummaryResponse }>(
        `/api/projects/${projectId}/dashboard/manage-summary`
      ).then((r) => r.data),
    enabled:   !!projectId,
    staleTime: STALE_TIME_MS,
  });

  // 카드 순서 — 사용자가 가장 자주 쓸 것부터 좌상단 → 우하단
  // 1행: 진행률(전체 시야) / 정체된 일(즉시 행동) / 마감/품질 시그널은 다음 행
  // 2행: 최근 변경 / 팀 활동 / AI 사용
  return (
    <div className="sp-dashboard-grid">
      <ProgressCard
        data={data?.progress}
        isLoading={isLoading}
        error={error as Error | null}
        projectId={projectId}
      />
      <StalledCard
        data={data?.stalled}
        isLoading={isLoading}
        error={error as Error | null}
        projectId={projectId}
      />
      <TeamActivityCard
        data={data?.teamActivity}
        isLoading={isLoading}
        error={error as Error | null}
        projectId={projectId}
      />
      <RecentChangesCard
        data={data?.recentChanges}
        isLoading={isLoading}
        error={error as Error | null}
        projectId={projectId}
      />
      <AiUsageCard
        data={data?.aiUsage}
        isLoading={isLoading}
        error={error as Error | null}
        projectId={projectId}
      />
    </div>
  );
}
