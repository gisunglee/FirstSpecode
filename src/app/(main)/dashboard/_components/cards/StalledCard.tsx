"use client";

/**
 * StalledCard — 관리뷰: 정체된 일 (마감 지났는데 미완료)
 *
 * 역할:
 *   - 마감일이 지났는데 진행률 < 100 인 단위업무
 *   - Top 5 미리보기 + 전체 건수
 *   - 각 행 클릭 → 단위업무 상세로 이동
 */

import Link from "next/link";
import DashboardCard from "../DashboardCard";

type StalledItem = {
  unitWorkId:       string;
  displayId:        string;
  name:             string;
  endDate:          string;
  progress:         number;
  assignMemberName: string | null;
};

type Props = {
  data: {
    count: number;
    items: StalledItem[];
  } | undefined;
  isLoading: boolean;
  error:     Error | null;
  projectId: string;
};

export default function StalledCard({ data, isLoading, error, projectId }: Props) {
  const isEmpty = !!data && data.count === 0;

  // "Top 5만 보여주는데 전체가 더 많을 때" 카운트 배지로 알림
  const moreCount = data ? Math.max(0, data.count - data.items.length) : 0;

  return (
    <DashboardCard
      icon={<AlertIcon />}
      title="정체된 일"
      badge={
        data && data.count > 0 ? (
          <span className="sp-badge sp-badge-error">
            <span className="dot" />
            {data.count}건
          </span>
        ) : null
      }
      linkHref={`/projects/${projectId}/unit-works`}
      linkLabel="모든 정체 항목 보기"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="🎉 정체된 항목이 없습니다."
    >
      {data && data.count > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {data.items.map((it) => (
            <Link
              key={it.unitWorkId}
              href={`/projects/${projectId}/unit-works/${it.unitWorkId}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "6px 8px",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--text-sm)",
                color: "var(--color-text-primary)",
                textDecoration: "none",
                gap: 8,
              }}
              className="sp-dashboard-row"
            >
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  // 담당자가 있을 때 1행에 [ID] 이름 + 2행에 담당자명 표시
                  display: "flex",
                  flexDirection: "column",
                  gap: 1,
                }}
                title={it.assignMemberName ? `${it.name} · 담당: ${it.assignMemberName}` : it.name}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--text-xs)",
                      color: "var(--color-text-tertiary)",
                      marginRight: 6,
                    }}
                  >
                    {it.displayId}
                  </span>
                  {it.name}
                </span>
                {it.assignMemberName && (
                  <span
                    style={{
                      fontSize: "var(--text-xs)",
                      color: "var(--color-text-tertiary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    담당: {it.assignMemberName}
                  </span>
                )}
              </span>
              <span
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--color-error)",
                  whiteSpace: "nowrap",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {it.endDate} · {it.progress}%
              </span>
            </Link>
          ))}

          {moreCount > 0 && (
            <div
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--color-text-tertiary)",
                padding: "4px 8px",
              }}
            >
              외 {moreCount}건
            </div>
          )}
        </div>
      )}
    </DashboardCard>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    </svg>
  );
}
