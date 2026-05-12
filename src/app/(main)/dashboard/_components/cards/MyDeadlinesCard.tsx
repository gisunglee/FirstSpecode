"use client";

/**
 * MyDeadlinesCard — 개발자뷰: 내 단위업무 마감 임박
 *
 * 역할:
 *   - 내가 담당한 단위업무 중 마감 D-7 이내 + 미완료
 *   - 지연(D-N negative) 항목은 빨강, 임박(0~7) 항목은 주황·기본
 *   - 클릭 → 단위업무 상세
 *
 * 데이터 출처:
 *   - me-summary 응답의 myDeadlines (count + overdueCount + items 5건)
 */

import Link from "next/link";
import DashboardCard from "../DashboardCard";

type DeadlineItem = {
  unitWorkId: string;
  displayId:  string;
  name:       string;
  endDate:    string;
  progress:   number;
  /** 음수 = 지연, 0 = 오늘, 양수 = 남은 일수 */
  dDay:       number;
};

type Props = {
  data: {
    count:        number;
    overdueCount: number;
    items:        DeadlineItem[];
  } | undefined;
  isLoading: boolean;
  error:     Error | null;
  projectId: string;
};

export default function MyDeadlinesCard({ data, isLoading, error, projectId }: Props) {
  const isEmpty = !!data && data.count === 0;
  const hasOverdue = !!data && data.overdueCount > 0;

  return (
    <DashboardCard
      icon={<ClockIcon />}
      title="마감 임박"
      badge={
        hasOverdue ? (
          <span className="sp-badge sp-badge-error">
            <span className="dot" />
            지연 {data!.overdueCount}건
          </span>
        ) : data && data.count > 0 ? (
          <span className="sp-badge sp-badge-warning">
            <span className="dot" />
            {data.count}건
          </span>
        ) : null
      }
      linkHref={`/projects/${projectId}/unit-works?assignedTo=me`}
      linkLabel="내 단위업무 보기"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="🌤 마감 임박한 항목이 없습니다."
    >
      {data && data.count > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {data.items.map((it) => {
            const dDayLabel = formatDDay(it.dDay);
            const isOverdue = it.dDay < 0;
            const isDueToday = it.dDay === 0;
            return (
              <Link
                key={it.unitWorkId}
                href={`/projects/${projectId}/unit-works/${it.unitWorkId}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "6px 8px",
                  borderRadius: "var(--radius-sm)",
                  textDecoration: "none",
                  color: "var(--color-text-primary)",
                  fontSize: "var(--text-sm)",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={it.name}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize:  "var(--text-xs)",
                      color:     "var(--color-text-tertiary)",
                      marginRight: 6,
                    }}
                  >
                    {it.displayId}
                  </span>
                  {it.name}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize:   "var(--text-xs)",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    color: isOverdue
                      ? "var(--color-error)"
                      : isDueToday
                        ? "var(--color-warning)"
                        : "var(--color-text-secondary)",
                  }}
                  title={it.endDate}
                >
                  {dDayLabel} · {it.progress}%
                </span>
              </Link>
            );
          })}

          {data.count > data.items.length && (
            <div
              style={{
                fontSize: "var(--text-xs)",
                color:    "var(--color-text-tertiary)",
                padding:  "4px 8px",
              }}
            >
              외 {data.count - data.items.length}건
            </div>
          )}
        </div>
      )}
    </DashboardCard>
  );
}

// D-day 라벨링
//   음수 → "D+N (지연)"
//   0    → "D-Day"
//   양수 → "D-N"
function formatDDay(d: number): string {
  if (d === 0) return "D-Day";
  if (d  < 0)  return `D+${-d}`; // 지연일수 양수로 표기
  return `D-${d}`;
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}
