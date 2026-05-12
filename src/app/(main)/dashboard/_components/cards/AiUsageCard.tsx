"use client";

/**
 * AiUsageCard — 관리뷰: AI 사용 통계 (이번 달)
 *
 * 역할:
 *   - 이번 달 AI 태스크 총 건수 + 상태별 분포
 *   - 완료율 (DONE+APPLIED) / (전체 - REJECTED)
 *   - 실패(FAILED/TIMEOUT) 건이 있으면 경고 배지
 *
 * 디자인 의도:
 *   - "이번 달 우리 팀이 AI 를 얼마나 활용했고, 잘 작동했는지" 한 번에 파악
 *   - 실패 건은 운영자가 신경 써야 하므로 별도 배지 + 색상 강조
 */

import DashboardCard from "../DashboardCard";

type Props = {
  data: {
    monthCount:      number;
    completedCount:  number;
    inProgressCount: number;
    failedCount:     number;
  } | undefined;
  isLoading: boolean;
  error:     Error | null;
  projectId: string;
};

export default function AiUsageCard({ data, isLoading, error, projectId }: Props) {
  const isEmpty = !!data && data.monthCount === 0;

  // 완료율 계산
  // 분모: 전체 - REJECTED. 사용자 거절은 시스템 성과와 무관하므로 제외.
  // 데이터에서 REJECTED 만 따로 제공받지 않으므로 단순화: 완료 / 월간 총 건수.
  const completedPct = data && data.monthCount > 0
    ? Math.round((data.completedCount / data.monthCount) * 100)
    : 0;

  return (
    <DashboardCard
      icon={<AiIcon />}
      title="AI 사용 (이번 달)"
      badge={
        data && data.failedCount > 0 ? (
          <span className="sp-badge sp-badge-warning">
            <span className="dot" />
            실패 {data.failedCount}건
          </span>
        ) : null
      }
      linkHref={`/projects/${projectId}/ai-tasks`}
      linkLabel="AI 태스크 보기"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="이번 달 AI 태스크 기록이 없습니다."
    >
      {data && data.monthCount > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* 큰 숫자 — 전체 + 완료율 */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div
                style={{
                  fontSize: "var(--text-3xl)",
                  fontWeight: 700,
                  color: "var(--color-text-heading)",
                  lineHeight: 1,
                }}
              >
                {data.monthCount}
              </div>
              <div
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--color-text-tertiary)",
                  marginTop: 2,
                }}
              >
                총 요청
              </div>
            </div>
            <div style={{ marginLeft: "auto", textAlign: "right" }}>
              <div
                style={{
                  fontSize: "var(--text-xl)",
                  fontWeight: 700,
                  color: "var(--color-success)",
                  lineHeight: 1,
                }}
              >
                {completedPct}%
              </div>
              <div
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--color-text-tertiary)",
                  marginTop: 2,
                }}
              >
                완료율
              </div>
            </div>
          </div>

          {/* 분포 막대 — 완료 / 진행 / 실패 비율 */}
          <DistributionBar
            segments={[
              { value: data.completedCount,  color: "var(--color-success)", label: "완료"   },
              { value: data.inProgressCount, color: "var(--color-info)",    label: "진행"   },
              { value: data.failedCount,     color: "var(--color-error)",   label: "실패"   },
            ]}
            total={data.monthCount}
          />

          {/* 범례 */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: "var(--text-xs)" }}>
            <Legend dot="var(--color-success)" label="완료"  value={data.completedCount} />
            <Legend dot="var(--color-info)"    label="진행"  value={data.inProgressCount} />
            <Legend dot="var(--color-error)"   label="실패"  value={data.failedCount} />
          </div>
        </div>
      )}
    </DashboardCard>
  );
}

function DistributionBar({
  segments,
  total,
}: {
  segments: Array<{ value: number; color: string; label: string }>;
  total:    number;
}) {
  if (total === 0) return null;
  return (
    <div
      style={{
        height: 8,
        borderRadius: "var(--radius-full)",
        background: "var(--color-border-subtle)",
        overflow: "hidden",
        display: "flex",
      }}
      role="img"
      aria-label={`AI 태스크 분포: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")}`}
    >
      {segments.map((s, i) => {
        const pct = (s.value / total) * 100;
        if (pct === 0) return null;
        return (
          <div
            key={i}
            style={{
              width: `${pct}%`,
              background: s.color,
              transition: "width 200ms ease",
            }}
          />
        );
      })}
    </div>
  );
}

function Legend({ dot, label, value }: { dot: string; label: string; value: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--color-text-secondary)" }}>
      <span
        aria-hidden
        style={{
          width: 8, height: 8, borderRadius: "var(--radius-full)", background: dot,
        }}
      />
      {label} {value}
    </span>
  );
}

function AiIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
      <path d="M9 10l2 2 4-4" />
    </svg>
  );
}
