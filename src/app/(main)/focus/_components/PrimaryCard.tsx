"use client";

/**
 * PrimaryCard — 포커스 모드의 메인 카드
 *
 * 역할:
 *   - 단위업무 1건을 "오늘 최우선" 으로 크게 강조
 *   - D-day 배지(지연/임박/일반) + 큰 제목 + 진행률 바 + CTA
 */

import Link from "next/link";
import type { FocusItem } from "@/types/focus";
import { useAppStore } from "@/store/appStore";

type Props = { item: FocusItem };

export default function PrimaryCard({ item }: Props) {
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const dDayBadge = formatDDayBadge(item.dDay);

  return (
    <div
      className="sp-group"
      style={{
        padding: 28,
        display: "flex",
        flexDirection: "column",
        gap: 18,
        background: "linear-gradient(135deg, var(--color-brand-subtle), var(--color-bg-card))",
        border: "1px solid var(--color-brand-border)",
      }}
    >
      {/* 상단 — D-day 배지 + 표시 ID */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span
          className={`sp-badge ${dDayBadge.tone}`}
          style={{ fontSize: "var(--text-sm)", padding: "5px 12px" }}
        >
          <span className="dot" />
          {dDayBadge.label}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-sm)",
            color: "var(--color-text-tertiary)",
          }}
        >
          {item.displayId} · {item.reqDisplayId}
        </span>
      </div>

      {/* 큰 제목 */}
      <h2
        style={{
          margin: 0,
          fontSize: "var(--text-2xl)",
          fontWeight: 700,
          color: "var(--color-text-heading)",
          lineHeight: 1.3,
        }}
      >
        {item.name}
      </h2>

      {/* 진행률 바 + 수치 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "var(--text-sm)",
            color: "var(--color-text-secondary)",
          }}
        >
          <span>진행률</span>
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{item.progress}%</span>
        </div>
        <div
          style={{
            height: 8,
            background: "var(--color-border-subtle)",
            borderRadius: "var(--radius-full)",
            overflow: "hidden",
          }}
          aria-hidden
        >
          <div
            style={{
              width: `${item.progress}%`,
              height: "100%",
              background: "var(--color-brand)",
              transition: "width 200ms ease",
            }}
          />
        </div>
      </div>

      {/* 메타 + CTA */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          paddingTop: 8,
          borderTop: "1px solid var(--color-border-subtle)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
            담당
          </span>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)" }}>
            {item.assigneeName ?? "(미지정)"}
          </span>
        </div>
        {item.endDate && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
              마감
            </span>
            <span
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--color-text-primary)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {item.endDate}
            </span>
          </div>
        )}
        <Link
          href={`/projects/${currentProjectId}/unit-works/${item.itemId}`}
          className="sp-btn sp-btn-primary sp-btn-lg"
          style={{
            marginLeft: "auto",
            textDecoration: "none",
            // sp-btn 가 a 태그에도 적용되도록 inline-flex 보강
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          지금 작업하기 <span aria-hidden>→</span>
        </Link>
      </div>
    </div>
  );
}

// ── D-day 배지 매핑 ─────────────────────────────────────────────────────────
//
// dDay null   → "마감 없음" / neutral
// dDay < 0    → "D+N 지연" / error
// dDay = 0    → "D-DAY" / warning
// dDay 1~3    → "D-N" / warning
// dDay 4~7    → "D-N" / info
// dDay > 7    → "D-N" / neutral
function formatDDayBadge(d: number | null): { label: string; tone: string } {
  if (d === null)            return { label: "마감 없음", tone: "sp-badge-neutral" };
  if (d <  0)                return { label: `D+${-d} 지연`, tone: "sp-badge-error" };
  if (d === 0)               return { label: "D-DAY",      tone: "sp-badge-warning" };
  if (d <= 3)                return { label: `D-${d}`,     tone: "sp-badge-warning" };
  if (d <= 7)                return { label: `D-${d}`,     tone: "sp-badge-info" };
  return { label: `D-${d}`, tone: "sp-badge-neutral" };
}
