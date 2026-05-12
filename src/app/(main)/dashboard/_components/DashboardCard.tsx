"use client";

/**
 * DashboardCard — 대시보드 공용 카드 셸
 *
 * 역할:
 *   - 모든 카드의 공통 골격(헤더 + 본문 + 푸터 링크) 을 제공.
 *   - 카드별 본문은 children 으로 주입.
 *   - 로딩/에러/빈 상태도 여기서 일관되게 처리해 카드들이 시각적으로 통일.
 *
 * 사용:
 *   <DashboardCard
 *     icon={<svg.../>}
 *     title="진행률"
 *     linkHref="/projects/123/unit-works"
 *     linkLabel="단위업무 보기"
 *     isLoading={isLoading}
 *     error={error}
 *   >
 *     ...본문 JSX
 *   </DashboardCard>
 */

import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
  /** 헤더 좌측 아이콘 (12px) */
  icon?:      ReactNode;
  title:      string;
  /** 헤더 우측 배지 (예: "5건") */
  badge?:     ReactNode;
  /** 본문 — 카드별 데이터 시각화 */
  children:   ReactNode;
  /** 푸터 링크 — 상세 페이지로 이동 */
  linkHref?:  string;
  linkLabel?: string;
  /** 로딩 상태 — 본문 자리에 skeleton */
  isLoading?: boolean;
  /** 에러 — 본문 자리에 메시지 표시 */
  error?:     Error | null;
  /** 데이터가 없을 때 표시할 메시지 (children 대신 표시) */
  emptyMessage?: string;
  isEmpty?:   boolean;
};

export default function DashboardCard({
  icon,
  title,
  badge,
  children,
  linkHref,
  linkLabel,
  isLoading,
  error,
  emptyMessage,
  isEmpty,
}: Props) {
  return (
    <div className="sp-group" style={{ display: "flex", flexDirection: "column" }}>
      <div className="sp-group-header">
        <div className="sp-group-title">
          {icon}
          {title}
        </div>
        {badge && <span>{badge}</span>}
      </div>

      <div
        className="sp-group-body"
        style={{
          flex: 1,
          // 카드들의 본문 높이를 어느 정도 맞춰 시각적 정렬
          minHeight: 140,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {isLoading ? (
          <CardSkeleton />
        ) : error ? (
          <CardError message={error.message} />
        ) : isEmpty ? (
          <CardEmpty message={emptyMessage ?? "표시할 데이터가 없습니다."} />
        ) : (
          children
        )}
      </div>

      {/* 에러 상태에서도 푸터 링크는 노출 — 사용자가 직접 페이지로 이동해 데이터 확인할 수 있어야 함.
          loading 상태에서만 숨김 (아직 데이터 형태가 결정 안 됨). */}
      {linkHref && linkLabel && !isLoading && (
        <div
          style={{
            padding: "9px 14px",
            borderTop: "1px solid var(--color-border-subtle)",
            fontSize: "var(--text-xs)",
          }}
        >
          <Link
            href={linkHref}
            style={{
              color: "var(--color-brand)",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {linkLabel}
            <span aria-hidden>→</span>
          </Link>
        </div>
      )}
    </div>
  );
}

// ─── 내부 상태 컴포넌트 ────────────────────────────────────────────────────────

function CardSkeleton() {
  // 골격 — 토큰 색상 + 미세 그라디언트로 구현 (애니메이션 없이도 식별 가능)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={skeletonBar(28, "60%")} />
      <div style={skeletonBar(12, "90%")} />
      <div style={skeletonBar(12, "75%")} />
      <div style={skeletonBar(12, "85%")} />
    </div>
  );
}

function CardError({ message }: { message: string }) {
  return (
    <div
      style={{
        fontSize: "var(--text-sm)",
        color: "var(--color-error)",
        padding: "8px 0",
      }}
    >
      ⚠ {message}
    </div>
  );
}

function CardEmpty({ message }: { message: string }) {
  return (
    <div
      style={{
        fontSize: "var(--text-sm)",
        color: "var(--color-text-tertiary)",
        padding: "12px 0",
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
      }}
    >
      {message}
    </div>
  );
}

function skeletonBar(height: number, width: string): React.CSSProperties {
  return {
    height,
    width,
    background: "var(--color-bg-elevated)",
    borderRadius: "var(--radius-sm)",
    opacity: 0.6,
  };
}
