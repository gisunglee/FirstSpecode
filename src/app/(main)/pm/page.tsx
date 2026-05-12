"use client";

/**
 * PmDashboardPage — PM 대시보드 (URL: /pm)
 *
 * 역할:
 *   - PM 의사결정용 종합 시야 — 자원·일정·위험 한 화면
 *   - 3 위젯: 팀 부하 매트릭스 / 위험 워치리스트 / 우선순위 히트맵
 *   - 모든 데이터는 단일 엔드포인트(/api/projects/[id]/pm-summary)에서
 *
 * 격리:
 *   - dashboard/, activity/, focus/, calendar/ 와 완전 분리된 폴더
 *   - 공유는 lib/utils.ts 뿐
 *
 * 레이아웃:
 *   - 상단: 팀 부하 매트릭스 (가로 폭 full)
 *   - 중단: 위험 워치리스트 + 우선순위 히트맵 (2열, 모바일에서는 1열)
 */

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";
import type { PmSummaryResponse } from "@/types/pm";

import TeamLoadMatrix  from "./_components/TeamLoadMatrix";
import RiskWatchlist   from "./_components/RiskWatchlist";
import PriorityHeatmap from "./_components/PriorityHeatmap";

// PM 대시보드는 의사결정용 — 너무 신선할 필요는 없지만 그렇다고 카드 대시보드처럼
// 5분 동안 안 갱신되면 위험 항목을 놓칠 수 있어 2분으로 절충.
const STALE_TIME_MS = 2 * 60 * 1000;

export default function PmDashboardPage() {
  const currentProjectId = useAppStore((s) => s.currentProjectId);

  const { data, isLoading, error } = useQuery<PmSummaryResponse>({
    queryKey: ["pm-summary", currentProjectId],
    queryFn: () =>
      authFetch<{ data: PmSummaryResponse }>(
        `/api/projects/${currentProjectId}/pm-summary`
      ).then((r) => r.data),
    enabled:   !!currentProjectId,
    staleTime: STALE_TIME_MS,
  });

  return (
    <div style={{ padding: 0 }}>
      {/* 헤더 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 24px",
          background: "var(--color-bg-card)",
          borderBottom: "1px solid var(--color-border)",
          marginBottom: 16,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
          📊 PM 대시보드
        </div>
        {data?.generatedAt && (
          <span
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--color-text-tertiary)",
              fontFamily: "var(--font-mono)",
            }}
          >
            기준: {data.generatedAt.slice(11, 16)} {data.generatedAt.slice(0, 10)}
          </span>
        )}
      </div>

      <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        {!currentProjectId ? (
          <NoProjectSelected />
        ) : (
          <>
            {/* 상단 — 팀 부하 매트릭스 (full width) */}
            <TeamLoadMatrix
              rows={data?.teamLoad ?? []}
              isLoading={isLoading}
              error={error as Error | null}
            />

            {/* 중단 — 위험 워치리스트 + 우선순위 히트맵 */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
                gap: 16,
              }}
            >
              <RiskWatchlist
                items={data?.riskItems ?? []}
                isLoading={isLoading}
                error={error as Error | null}
              />
              <PriorityHeatmap
                matrix={data?.priorityMatrix ?? EMPTY_MATRIX}
                isLoading={isLoading}
                error={error as Error | null}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// 로딩 중 widget 으로 넘기는 임시 매트릭스 — 모든 셀 0
const EMPTY_MATRIX: PmSummaryResponse["priorityMatrix"] = {
  cells: {
    HIGH:   { notStarted: 0, inProgress: 0, completed: 0 },
    MEDIUM: { notStarted: 0, inProgress: 0, completed: 0 },
    LOW:    { notStarted: 0, inProgress: 0, completed: 0 },
  },
  rowTotals: { HIGH: 0, MEDIUM: 0, LOW: 0 },
  grandTotal: 0,
};

function NoProjectSelected() {
  return (
    <div
      className="sp-empty"
      style={{
        padding: "48px 24px",
        textAlign: "center",
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-card)",
      }}
    >
      <div className="sp-empty-icon">📁</div>
      <div className="sp-empty-title">프로젝트를 선택해 주세요</div>
      <div className="sp-empty-desc">
        상단 프로젝트 선택기에서 프로젝트를 고르면 PM 대시보드가 표시됩니다.
      </div>
    </div>
  );
}
