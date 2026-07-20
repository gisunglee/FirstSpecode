"use client";

/**
 * ManageView — 관리뷰 (미지정 배너 + 5개 카드 그리드)
 *
 * 역할:
 *   - manage-summary 단일 엔드포인트 호출 → 배너 1개 + 카드 5개에 분배
 *   - 카드 컴포넌트 자체에서 isLoading/error/empty 처리
 *
 * 데이터:
 *   GET /api/projects/[id]/dashboard/manage-summary
 *
 * 2026-07-20: 담당자 미입력 항목은 지연 판정 자체가 안 되는 사각지대라 카드 그리드 위에
 *   별도 배너로 노출(PM 진단의 "미지정 현황" 위젯과 같은 문제의식) — unassignedTotal=0이면
 *   배너 자체를 렌더하지 않는다.
 */

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
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
    <>
      {!isLoading && !error && data && data.unassignedTotal > 0 && (
        <Link
          href="/pm?focus=missing"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            marginBottom: 16,
            background: "var(--color-warning-subtle)",
            border: "1px solid var(--color-warning-border)",
            borderRadius: "var(--radius-card)",
            color: "var(--color-text-primary)",
            fontSize: "var(--text-sm)",
            textDecoration: "none",
          }}
        >
          ⚠ 담당자·일정 미입력 항목이 <strong>{data.unassignedTotal}건</strong> 있어요 — PM 진단에서 확인
          <span aria-hidden style={{ marginLeft: "auto" }}>→</span>
        </Link>
      )}
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
    </>
  );
}
