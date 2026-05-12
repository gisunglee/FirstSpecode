"use client";

/**
 * TeamActivityCard — 관리뷰: 팀 활동 (최근 7일)
 *
 * 역할:
 *   - 최근 7일간 한 번 이상 변경 활동을 한 멤버 수
 *   - Top 기여자 3명 (변경 건수 내림차순)
 *
 * 데이터 출처:
 *   - tb_ds_design_change groupBy(chg_mber_id) 7일 윈도우 (manage-summary)
 *   - "활동" 정의: 설계 변경 이벤트가 발생한 것. 팀의 작업량 시그널.
 */

import DashboardCard from "../DashboardCard";

type Contributor = {
  mberId:      string;
  displayName: string;
  count:       number;
};

type Props = {
  data: {
    activeMemberCount: number;
    topContributors:   Contributor[];
  } | undefined;
  isLoading: boolean;
  error:     Error | null;
  projectId: string;
};

export default function TeamActivityCard({ data, isLoading, error, projectId }: Props) {
  const isEmpty = !!data && data.activeMemberCount === 0;

  // Top 기여자 막대 길이 계산 — 1위 대비 비율
  const maxCount = data?.topContributors[0]?.count ?? 0;

  return (
    <DashboardCard
      icon={<TeamIcon />}
      title="팀 활동 (최근 7일)"
      badge={
        data && data.activeMemberCount > 0 ? (
          <span className="sp-badge sp-badge-info">
            <span className="dot" />
            {data.activeMemberCount}명
          </span>
        ) : null
      }
      linkHref={`/projects/${projectId}/members`}
      linkLabel="멤버 보기"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="최근 7일간 활동 기록이 없습니다."
    >
      {data && data.topContributors.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--color-text-tertiary)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Top 기여자
          </div>
          {data.topContributors.map((c, idx) => {
            const pct = maxCount > 0 ? Math.round((c.count / maxCount) * 100) : 0;
            return (
              <div
                key={c.mberId}
                style={{ display: "flex", flexDirection: "column", gap: 4 }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: "var(--text-sm)",
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--text-xs)",
                        color: "var(--color-text-tertiary)",
                      }}
                    >
                      #{idx + 1}
                    </span>
                    <span title={c.displayName}>{c.displayName}</span>
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--text-xs)",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    {c.count}건
                  </span>
                </div>
                {/* 막대 게이지 — 1위 기준 비율 */}
                <div
                  style={{
                    height: 4,
                    borderRadius: "var(--radius-full)",
                    background: "var(--color-border-subtle)",
                    overflow: "hidden",
                  }}
                  aria-hidden
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      background: "var(--color-brand)",
                      transition: "width 200ms ease",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </DashboardCard>
  );
}

function TeamIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
