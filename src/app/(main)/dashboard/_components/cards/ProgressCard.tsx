"use client";

/**
 * ProgressCard — 관리뷰: 단위업무 진행률
 *
 * 역할:
 *   - 평균 진행률(%) 강조 표기 + 미니 도넛
 *   - 완료 / 전체 건수
 *   - 클릭 → 단위업무 목록으로
 */

import DashboardCard from "../DashboardCard";

type Props = {
  data: {
    total:      number;
    completed:  number;
    averagePct: number;
  } | undefined;
  isLoading: boolean;
  error:     Error | null;
  projectId: string;
};

// 도넛은 SVG 한 개로 충분 — Recharts 같은 외부 의존 없이 가볍게.
// 반지름 36, stroke 8 → 88x88 viewBox.
const DONUT_R     = 36;
const DONUT_C     = 2 * Math.PI * DONUT_R; // 둘레
const DONUT_SIZE  = 88;

export default function ProgressCard({ data, isLoading, error, projectId }: Props) {
  const isEmpty = !!data && data.total === 0;
  const pct     = data?.averagePct ?? 0;
  const dashOff = DONUT_C * (1 - pct / 100);

  return (
    <DashboardCard
      icon={<DonutIcon />}
      title="진행률"
      linkHref={`/projects/${projectId}/unit-works`}
      linkLabel="단위업무 보기"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="아직 단위업무가 없습니다."
    >
      {data && data.total > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* 도넛 — 평균 진행률 시각화 */}
          <svg
            width={DONUT_SIZE}
            height={DONUT_SIZE}
            viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
            style={{ flexShrink: 0 }}
            aria-hidden
          >
            {/* 트랙 — 회색 배경 원 */}
            <circle
              cx={DONUT_SIZE / 2} cy={DONUT_SIZE / 2} r={DONUT_R}
              fill="none"
              stroke="var(--color-border)"
              strokeWidth={8}
            />
            {/* 채워진 호 — 회전 -90 으로 12시 방향에서 시작 */}
            <circle
              cx={DONUT_SIZE / 2} cy={DONUT_SIZE / 2} r={DONUT_R}
              fill="none"
              stroke="var(--color-brand)"
              strokeWidth={8}
              strokeLinecap="round"
              strokeDasharray={DONUT_C}
              strokeDashoffset={dashOff}
              transform={`rotate(-90 ${DONUT_SIZE / 2} ${DONUT_SIZE / 2})`}
            />
            <text
              x="50%" y="50%"
              dominantBaseline="middle"
              textAnchor="middle"
              fontSize="16"
              fontWeight={700}
              fill="var(--color-text-heading)"
            >
              {pct}%
            </text>
          </svg>

          {/* 숫자 영역 */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <Stat label="전체 단위업무" value={`${data.total}건`} />
            <Stat
              label="완료"
              value={`${data.completed}건`}
              valueColor="var(--color-success)"
            />
            <Stat
              label="진행 중"
              value={`${data.total - data.completed}건`}
              valueColor="var(--color-brand)"
            />
          </div>
        </div>
      )}
    </DashboardCard>
  );
}

function Stat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>{label}</span>
      <span
        style={{
          fontSize:   "var(--text-base)",
          fontWeight: 600,
          color:      valueColor ?? "var(--color-text-primary)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function DonutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}
