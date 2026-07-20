"use client";

/**
 * ProgressCard — 관리뷰: 진행률 (단위업무 중심 + 요구사항/화면/기능 보조 지표)
 *
 * 역할:
 *   - 단위업무 평균 진행률(%) 강조 표기 + 미니 도넛 + 완료/전체 건수
 *   - 하단에 요구사항 분석·화면 설계·기능 구현 평균 진행률을 한 줄씩 보조 표기
 *     (단위업무만 보여주면 다른 3개 엔티티 진행 상황이 대시보드에서 아예 안 보이는 사각지대가
 *     있었음 — 전체 7카테고리 상세는 PM 현황(/pm-board)으로 유도)
 *   - 클릭 → PM 현황
 */

import DashboardCard from "../DashboardCard";

type Props = {
  data: {
    total:      number;
    completed:  number;
    averagePct: number;
    requirementAvgPct:   number;
    screenDesignAvgPct:  number;
    functionImplAvgPct:  number;
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

export default function ProgressCard({ data, isLoading, error }: Props) {
  const isEmpty = !!data && data.total === 0;
  const pct     = data?.averagePct ?? 0;
  const dashOff = DONUT_C * (1 - pct / 100);

  return (
    <DashboardCard
      icon={<DonutIcon />}
      title="진행률"
      linkHref="/pm-board"
      linkLabel="PM 현황에서 전체 보기"
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

      {/* 보조 지표 — 단위업무 외 3개 엔티티 평균 진행률. 목록·상세는 PM 현황에서. */}
      {data && data.total > 0 && (
        <div
          style={{
            display: "flex",
            gap: 10,
            marginTop: 12,
            paddingTop: 10,
            borderTop: "1px dashed var(--color-border-subtle)",
            fontSize: "var(--text-xs)",
          }}
        >
          <MiniStat label="요구사항 분석" value={data.requirementAvgPct} />
          <MiniStat label="화면 설계" value={data.screenDesignAvgPct} />
          <MiniStat label="기능 구현" value={data.functionImplAvgPct} />
        </div>
      )}
    </DashboardCard>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ color: "var(--color-text-tertiary)" }}>{label}</span>
      <span style={{ fontWeight: 600, color: "var(--color-text-primary)", fontFamily: "var(--font-mono)" }}>
        {value}%
      </span>
    </div>
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
