"use client";

/**
 * NextCard — 포커스 모드의 보조 카드 (PrimaryCard 아래에 2개 배치)
 *
 * 역할:
 *   - "다음에 할 일" 후보를 작게 미리보기
 *   - 클릭 시 단위업무 상세
 */

import Link from "next/link";
import type { FocusItem } from "@/types/focus";
import { useAppStore } from "@/store/appStore";

type Props = { item: FocusItem };

export default function NextCard({ item }: Props) {
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const dDayBadge = formatDDayBadgeSmall(item.dDay);

  return (
    <Link
      href={`/projects/${currentProjectId}/unit-works/${item.itemId}`}
      className="sp-group"
      style={{
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        textDecoration: "none",
        color: "var(--color-text-primary)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span
          className={`sp-badge ${dDayBadge.tone}`}
          style={{ fontSize: "var(--text-xs)" }}
        >
          {dDayBadge.label}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-xs)",
            color: "var(--color-text-tertiary)",
          }}
        >
          {item.displayId}
        </span>
      </div>

      <div
        style={{
          fontSize: "var(--text-base)",
          fontWeight: 600,
          color: "var(--color-text-heading)",
          // 한 줄로 자르기 — 2줄 클램프는 webkit 의존이라 단순화
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={item.name}
      >
        {item.name}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "var(--text-xs)",
          color: "var(--color-text-tertiary)",
        }}
      >
        <span>진행 {item.progress}%</span>
        {item.endDate && (
          <span style={{ fontFamily: "var(--font-mono)" }}>{item.endDate}</span>
        )}
      </div>

      {/* 진행률 게이지 */}
      <div
        style={{
          height: 3,
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
          }}
        />
      </div>
    </Link>
  );
}

// PrimaryCard 와 동일 로직이지만 라벨이 더 짧음 — 작은 배지용
function formatDDayBadgeSmall(d: number | null): { label: string; tone: string } {
  if (d === null) return { label: "마감 없음", tone: "sp-badge-neutral" };
  if (d <  0)     return { label: `D+${-d}`,   tone: "sp-badge-error" };
  if (d === 0)    return { label: "D-DAY",     tone: "sp-badge-warning" };
  return { label: `D-${d}`, tone: d <= 7 ? "sp-badge-info" : "sp-badge-neutral" };
}
