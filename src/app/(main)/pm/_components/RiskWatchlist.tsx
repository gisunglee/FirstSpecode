"use client";

/**
 * RiskWatchlist — 위험 워치리스트
 *
 * 역할:
 *   - 위험 점수 높은 단위업무 Top 10
 *   - 행마다 마감 / 진행률 / 담당자 / 위험 사유 표시
 *   - 클릭 → 단위업무 상세
 *
 * 위험 사유 라벨링:
 *   - "지연 N일", "D-3", "고우선순위", "미할당", "미시작"
 *   - 점수 산정 로직은 lib/pm/riskScore.ts 단일 진실원
 */

import Link from "next/link";
import { useAppStore } from "@/store/appStore";
import type { RiskItem } from "@/types/pm";

type Props = {
  items:     RiskItem[];
  isLoading: boolean;
  error:     Error | null;
};

export default function RiskWatchlist({ items, isLoading, error }: Props) {
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const hasItems = items.length > 0;

  return (
    <div className="sp-group">
      <div className="sp-group-header">
        <div className="sp-group-title">
          <AlertIcon />
          위험 워치리스트
        </div>
        {hasItems && (
          <span className="sp-badge sp-badge-error">
            <span className="dot" />
            {items.length}건
          </span>
        )}
      </div>
      <div className="sp-group-body" style={{ padding: 0 }}>
        {isLoading ? (
          <Skeleton />
        ) : error ? (
          <ErrorBox message={error.message} />
        ) : !hasItems ? (
          <Empty />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {items.map((it) => (
              <li
                key={it.unitWorkId}
                style={{ borderBottom: "1px solid var(--color-border-subtle)" }}
              >
                <Link
                  href={`/projects/${currentProjectId}/unit-works/${it.unitWorkId}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    gap: 12,
                    padding: "10px 14px",
                    textDecoration: "none",
                    color: "var(--color-text-primary)",
                    alignItems: "center",
                  }}
                >
                  {/* 좌측 — D-day + 표시 ID */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 70 }}>
                    <DDayBadge dDay={it.dDay} />
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--text-xs)",
                        color: "var(--color-text-tertiary)",
                      }}
                    >
                      {it.displayId}
                    </span>
                  </div>

                  {/* 중앙 — 이름 + 사유 태그들 */}
                  <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                    <span
                      style={{
                        fontSize: "var(--text-sm)",
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={it.name}
                    >
                      {it.name}
                    </span>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {it.reasons.map((r) => (
                        <span
                          key={r}
                          className={`sp-badge ${reasonTone(r)}`}
                          style={{ fontSize: "var(--text-xs)", padding: "1px 6px" }}
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* 우측 — 진행률 + 담당자 */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, minWidth: 100 }}>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--text-sm)",
                        fontWeight: 600,
                        color: it.progress === 0
                          ? "var(--color-error)"
                          : it.progress < 50
                            ? "var(--color-warning)"
                            : "var(--color-text-primary)",
                      }}
                    >
                      {it.progress}%
                    </span>
                    <span
                      style={{
                        fontSize: "var(--text-xs)",
                        color: "var(--color-text-tertiary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 100,
                      }}
                    >
                      {it.assigneeName ?? "(미할당)"}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DDayBadge({ dDay }: { dDay: number | null }) {
  const { label, tone } = formatDDay(dDay);
  return (
    <span
      className={`sp-badge ${tone}`}
      style={{ fontSize: "var(--text-xs)", fontWeight: 700, padding: "2px 8px" }}
    >
      {label}
    </span>
  );
}

function formatDDay(d: number | null): { label: string; tone: string } {
  if (d === null) return { label: "마감 없음", tone: "sp-badge-neutral" };
  if (d <  0)     return { label: `D+${-d}`, tone: "sp-badge-error" };
  if (d === 0)    return { label: "D-DAY",   tone: "sp-badge-warning" };
  if (d <= 3)     return { label: `D-${d}`,  tone: "sp-badge-warning" };
  if (d <= 7)     return { label: `D-${d}`,  tone: "sp-badge-info" };
  return            { label: `D-${d}`,  tone: "sp-badge-neutral" };
}

// 사유 라벨 → 배지 톤. lib/pm/riskScore.ts 와 라벨 문자열이 일치.
function reasonTone(reason: string): string {
  if (reason.startsWith("지연"))          return "sp-badge-error";
  if (reason.startsWith("D-") || reason === "오늘 마감") return "sp-badge-warning";
  if (reason === "고우선순위")            return "sp-badge-accent";
  if (reason === "미할당")                return "sp-badge-error";
  if (reason === "미시작")                return "sp-badge-neutral";
  return "sp-badge-neutral";
}

// ── 상태 컴포넌트 ───────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{
            height: 44,
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
      🎉 위험 항목이 없습니다.
    </div>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}
