"use client";

/**
 * TeamLoadMatrix — 팀 부하 매트릭스
 *
 * 역할:
 *   - 멤버 × 작업 상태(담당/진행중/임박/지연/완료) 표
 *   - 활성 작업량 게이지로 "누가 과부하인지 / 누가 비어있는지" 즉시 파악
 *
 * 시각화 규칙:
 *   - activeLoad 가 가장 큰 멤버를 100% 로 두고 다른 멤버를 상대 비율로
 *   - >=80% → 빨강(과부하), 50~80% → 노랑(보통), <50% → 초록(여유)
 *   - 완료(completed)는 별도 회색 — 누적 성과 표시
 */

import type { TeamLoadRow } from "@/types/pm";

type Props = {
  rows:      TeamLoadRow[];
  isLoading: boolean;
  error:     Error | null;
};

export default function TeamLoadMatrix({ rows, isLoading, error }: Props) {
  return (
    <div className="sp-group">
      <div className="sp-group-header">
        <div className="sp-group-title">
          <PeopleIcon />
          팀 부하 매트릭스
        </div>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
          {rows.length}명
        </span>
      </div>
      <div className="sp-group-body" style={{ padding: 0 }}>
        {isLoading ? (
          <Skeleton />
        ) : error ? (
          <ErrorBox message={error.message} />
        ) : rows.length === 0 ? (
          <Empty />
        ) : (
          <Matrix rows={rows} />
        )}
      </div>
    </div>
  );
}

function Matrix({ rows }: { rows: TeamLoadRow[] }) {
  const maxLoad = Math.max(1, ...rows.map((r) => r.activeLoad));

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        className="sp-table"
        style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}
      >
        <thead>
          <tr>
            <th style={thStyle}>멤버</th>
            <th style={thNumStyle}>담당</th>
            <th style={thNumStyle}>진행중</th>
            <th style={thNumStyle}>마감 임박</th>
            <th style={thNumStyle}>지연</th>
            <th style={thNumStyle}>완료</th>
            <th style={{ ...thStyle, width: 220 }}>활성 작업량</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pct = Math.round((r.activeLoad / maxLoad) * 100);
            const tone = loadTone(pct);
            return (
              <tr key={r.mberId}>
                <td
                  style={{
                    ...tdStyle,
                    maxWidth: 220,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={r.displayName}
                >
                  {r.displayName}
                </td>
                <td style={tdNumStyle}>{r.total}</td>
                <td style={tdNumStyle}>{r.inProgress}</td>
                <td style={{ ...tdNumStyle, color: r.dueSoon > 0 ? "var(--color-warning)" : undefined }}>
                  {r.dueSoon}
                </td>
                <td style={{ ...tdNumStyle, color: r.overdue > 0 ? "var(--color-error)" : undefined }}>
                  {r.overdue}
                </td>
                <td style={{ ...tdNumStyle, color: "var(--color-text-tertiary)" }}>{r.completed}</td>
                <td style={tdStyle}>
                  <LoadBar pct={pct} tone={tone} label={`${r.activeLoad}건`} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LoadBar({ pct, tone, label }: { pct: number; tone: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          flex: 1,
          height: 8,
          background: "var(--color-border-subtle)",
          borderRadius: "var(--radius-full)",
          overflow: "hidden",
        }}
        aria-hidden
      >
        <div
          style={{
            width: `${Math.max(2, pct)}%`,
            height: "100%",
            background: tone,
            transition: "width 200ms ease",
          }}
        />
      </div>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-xs)",
          color: "var(--color-text-secondary)",
          minWidth: 36,
          textAlign: "right",
        }}
      >
        {label}
      </span>
    </div>
  );
}

// 부하 비율 → 색 톤 (semantic 토큰만 사용 — 3테마 자동 대응)
function loadTone(pct: number): string {
  if (pct >= 80) return "var(--color-error)";
  if (pct >= 50) return "var(--color-warning)";
  return "var(--color-success)";
}

// ── 상태 컴포넌트 ───────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            height: 28,
            background: "var(--color-bg-elevated)",
            borderRadius: "var(--radius-sm)",
            opacity: 0.5,
          }}
        />
      ))}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div style={{ padding: 16, color: "var(--color-error)", fontSize: "var(--text-sm)" }}>
      ⚠ {message}
    </div>
  );
}

function Empty() {
  return (
    <div
      style={{
        padding: "32px 16px",
        textAlign: "center",
        color: "var(--color-text-tertiary)",
        fontSize: "var(--text-sm)",
      }}
    >
      담당자가 지정된 단위업무가 없습니다.
    </div>
  );
}

// ── 스타일 ─────────────────────────────────────────────────────────────────
const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  fontSize: "var(--text-xs)",
  fontWeight: 600,
  color: "var(--color-text-tertiary)",
  borderBottom: "1px solid var(--color-border-subtle)",
  background: "var(--color-bg-elevated)",
};
const thNumStyle: React.CSSProperties = {
  ...thStyle,
  textAlign: "right",
  width: 70,
};
const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: "var(--text-sm)",
  borderBottom: "1px solid var(--color-border-subtle)",
  color: "var(--color-text-primary)",
};
const tdNumStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: "right",
  fontFamily: "var(--font-mono)",
};

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
