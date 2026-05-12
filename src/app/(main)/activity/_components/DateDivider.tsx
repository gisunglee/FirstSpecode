"use client";

/**
 * DateDivider — 활동 피드 날짜 구분선
 *
 * 역할:
 *   - "오늘", "어제", "2일 전", "YYYY-MM-DD" 등으로 그룹 라벨링
 *   - 피드 항목들이 길어질 때 시간 흐름을 시각적으로 끊어준다.
 */

type Props = { label: string };

export default function DateDivider({ label }: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "16px 12px 6px",
        position: "sticky",
        top: 0,
        // sticky 시 뒤 배경 비치는 것 방지
        background: "var(--color-bg-root)",
        zIndex: 1,
      }}
    >
      <div
        style={{
          fontSize: "var(--text-xs)",
          color: "var(--color-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          flex: 1,
          height: 1,
          background: "var(--color-border-subtle)",
        }}
      />
    </div>
  );
}
