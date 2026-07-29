"use client";

/**
 * MyDeadlinesCard — 개발자뷰: 내 마감 임박 (단위업무 + 화면·기능 카운트)
 *
 * 역할:
 *   - 내가 담당한 단위업무 중 설계·구현 phase 하나라도 마감 D-7 이내+미완료(목록 미리보기)
 *   - 대표 D-day는 두 phase 중 더 급한(작은) 값 — 지연(D-N negative) 항목은 빨강,
 *     임박(0~7) 항목은 주황·기본. 그 D-day를 만든 phase(설계/구현) % 만 같은 색으로
 *     강조하고 나머지 phase는 톤 다운 — 어느 phase가 급한지 색만 보고 알 수 있게.
 *   - 상단에 화면(설계)/기능(구현) 마감 임박 카운트도 함께 표기 — 단위업무만 보면
 *     내가 담당한 화면·기능 마감을 놓치는 사각지대가 있었음(전체 목록은 MY 보드에서).
 *   - 클릭 → 단위업무 상세
 *
 * 데이터 출처:
 *   - me-summary 응답의 myDeadlines (count + overdueCount + items 5건 + screenCount/functionCount)
 */

import Link from "next/link";
import DashboardCard from "../DashboardCard";
import HelpButton from "@/components/common/HelpButton";

type PhaseInfo = { endDate: string | null; progress: number };

type DeadlineItem = {
  unitWorkId: string;
  displayId:  string;
  name:       string;
  /** 설계/구현 D-day 중 더 급한 값. 음수 = 지연, 0 = 오늘, 양수 = 남은 일수 */
  dDay:       number;
  /** dDay 를 결정한 phase */
  dDaySource: "DESIGN" | "IMPL";
  design:     PhaseInfo;
  impl:       PhaseInfo;
};

type Props = {
  data: {
    count:        number;
    overdueCount: number;
    items:        DeadlineItem[];
    screenCount:   number;
    functionCount: number;
  } | undefined;
  isLoading: boolean;
  error:     Error | null;
  projectId: string;
};

export default function MyDeadlinesCard({ data, isLoading, error, projectId }: Props) {
  // 단위업무 목록이 비어도 화면/기능 마감이 있으면 빈 상태로 숨기지 않는다
  const isEmpty = !!data && data.count === 0 && data.screenCount === 0 && data.functionCount === 0;
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
      help={
        <HelpButton title="마감 임박 기준">
          <p><b>배지(개수)</b> — 설계 또는 구현 마감이 7일 이내(이미 지난 지연 포함)인 단위업무 개수입니다.</p>
          <p><b>목록</b> — 설계·구현 마감이 임박했거나 지났는데 아직 완성되지 않은 단위업무입니다.</p>
          <p><b>화면 N · 기능 N</b> — 목록과 별개로, 내가 담당한 화면·기능의 구현 마감 임박/지연 건수입니다.</p>
        </HelpButton>
      }
      linkHref="/my-work"
      linkLabel="MY 보드에서 전체 보기"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="🌤 마감 임박한 항목이 없습니다."
    >
      {data && (data.count > 0 || data.screenCount > 0 || data.functionCount > 0) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--color-text-tertiary)",
              paddingBottom: 2,
            }}
          >
            단위업무 {data.count} · 화면 {data.screenCount} · 기능 {data.functionCount}
          </div>
          {data.items.map((it) => {
            const dDayLabel  = formatDDay(it.dDay);
            const isOverdue  = it.dDay < 0;
            const isDueToday = it.dDay === 0;
            const dDayColor = isOverdue
              ? "var(--color-error)"
              : isDueToday
                ? "var(--color-warning)"
                : "var(--color-text-secondary)";
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
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 1,
                    fontSize: "var(--text-xs)",
                    whiteSpace: "nowrap",
                  }}
                  title={`설계 ${it.design.endDate ?? "-"} / 구현 ${it.impl.endDate ?? "-"}`}
                >
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: dDayColor }}>
                    {dDayLabel}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)" }}>
                    <span style={{ color: it.dDaySource === "DESIGN" ? dDayColor : "var(--color-text-tertiary)" }}>
                      설계 {it.design.progress}%
                    </span>
                    {" · "}
                    <span style={{ color: it.dDaySource === "IMPL" ? dDayColor : "var(--color-text-tertiary)" }}>
                      구현 {it.impl.progress}%
                    </span>
                  </span>
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
