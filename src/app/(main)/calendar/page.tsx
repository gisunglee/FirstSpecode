"use client";

/**
 * CalendarPage — 캘린더 대시보드 (URL: /calendar)
 *
 * 역할:
 *   - 단위업무 종료일을 월간 그리드에 배치
 *   - 이전/다음 달 네비게이션 + "오늘로" 버튼
 *   - 본인 담당만 필터 토글
 *
 * 격리:
 *   - 다른 대시보드와 폴더 완전 분리
 *   - 그리드는 _components/MonthGrid.tsx
 *
 * 데이터:
 *   GET /api/projects/[id]/calendar?ym=YYYY-MM
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";
import type { CalendarResponse } from "@/types/calendar";

import MonthGrid from "./_components/MonthGrid";

const STALE_TIME_MS = 60 * 1000;

export default function CalendarPage() {
  const currentProjectId = useAppStore((s) => s.currentProjectId);

  // 현재 보고 있는 월 — { year, month(1~12) }
  const [view, setView] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });

  // 본인 담당만 필터
  const [myOnly, setMyOnly] = useState(false);

  const ym = `${view.year}-${pad2(view.month)}`;

  const { data, isLoading, error } = useQuery<CalendarResponse>({
    queryKey: ["calendar", currentProjectId, ym],
    queryFn: () =>
      authFetch<{ data: CalendarResponse }>(
        `/api/projects/${currentProjectId}/calendar?ym=${ym}`
      ).then((r) => r.data),
    enabled:   !!currentProjectId,
    staleTime: STALE_TIME_MS,
  });

  // 합산 통계 — 헤더 옆 표시용
  const summary = useMemo(() => {
    const items = data?.items ?? [];
    const visible = myOnly ? items.filter((it) => it.isMine) : items;
    const completed = visible.filter((it) => it.progress >= 100).length;
    const todayStr  = new Date().toISOString().slice(0, 10);
    const overdue   = visible.filter((it) => it.endDate < todayStr && it.progress < 100).length;
    return { total: visible.length, completed, overdue };
  }, [data, myOnly]);

  return (
    <div style={{ padding: 0 }}>
      {/* 헤더 — 월 네비 + 통계 + 필터 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 24px",
          background: "var(--color-bg-card)",
          borderBottom: "1px solid var(--color-border)",
          marginBottom: 16,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
            📅 {view.year}년 {view.month}월
          </h1>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              className="sp-btn sp-btn-secondary sp-btn-sm"
              onClick={() => setView(prevMonth)}
              aria-label="이전 달"
            >
              ←
            </button>
            <button
              className="sp-btn sp-btn-secondary sp-btn-sm"
              onClick={() => setView(today)}
            >
              오늘
            </button>
            <button
              className="sp-btn sp-btn-secondary sp-btn-sm"
              onClick={() => setView(nextMonth)}
              aria-label="다음 달"
            >
              →
            </button>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          {data && (
            <div style={{ display: "flex", gap: 16, fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
              <span>전체 <strong style={{ color: "var(--color-text-primary)" }}>{summary.total}</strong></span>
              <span style={{ color: "var(--color-success)" }}>완료 {summary.completed}</span>
              {summary.overdue > 0 && (
                <span style={{ color: "var(--color-error)" }}>지연 {summary.overdue}</span>
              )}
            </div>
          )}

          <label
            className="sp-checkbox-wrap"
            style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}
          >
            <input
              className="sp-checkbox"
              type="checkbox"
              checked={myOnly}
              onChange={(e) => setMyOnly(e.target.checked)}
            />
            <span>내 담당만</span>
          </label>
        </div>
      </div>

      <div style={{ padding: "0 24px 24px" }}>
        {!currentProjectId ? (
          <NoProjectSelected />
        ) : isLoading ? (
          <CalendarSkeleton />
        ) : error ? (
          <CalendarError message={(error as Error).message} />
        ) : (
          <>
            <MonthGrid
              year={view.year}
              month={view.month}
              items={data?.items ?? []}
              myOnly={myOnly}
            />
            <Legend />
          </>
        )}
      </div>
    </div>
  );
}

// ── 월 네비게이션 ──────────────────────────────────────────────────────────
//
// 순수 함수로 분리 — setView 안에서 호출할 때 의존성 없음.
function prevMonth(prev: { year: number; month: number }) {
  if (prev.month === 1) return { year: prev.year - 1, month: 12 };
  return { year: prev.year, month: prev.month - 1 };
}
function nextMonth(prev: { year: number; month: number }) {
  if (prev.month === 12) return { year: prev.year + 1, month: 1 };
  return { year: prev.year, month: prev.month + 1 };
}
function today() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function pad2(n: number): string { return String(n).padStart(2, "0"); }

// ── 범례 ──────────────────────────────────────────────────────────────────
function Legend() {
  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        padding: "12px 4px 0",
        fontSize: "var(--text-xs)",
        color: "var(--color-text-tertiary)",
        flexWrap: "wrap",
      }}
    >
      <LegendDot color="var(--color-success)" label="완료(100%)" />
      <LegendDot color="var(--color-info)"    label="진행 중" />
      <LegendDot color="var(--color-error)"   label="지연" />
      <span style={{ marginLeft: 8 }}>
        오늘은 <span
          style={{
            display: "inline-block",
            width: 16, height: 16,
            background: "var(--color-brand)",
            borderRadius: "var(--radius-full)",
            verticalAlign: "middle",
            marginLeft: 4,
          }}
        /> 표시
      </span>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span
        aria-hidden
        style={{
          width: 8, height: 8,
          borderRadius: "var(--radius-full)",
          background: color,
        }}
      />
      {label}
    </span>
  );
}

// ── 상태 컴포넌트 ─────────────────────────────────────────────────────────
function CalendarSkeleton() {
  return (
    <div className="sp-group" style={{ padding: 12, minHeight: 600, opacity: 0.4 }}>
      <div style={{ height: 24, background: "var(--color-bg-elevated)", marginBottom: 12 }} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gridAutoRows: "96px",
          gap: 1,
          background: "var(--color-border-subtle)",
        }}
      >
        {Array.from({ length: 42 }, (_, i) => (
          <div key={i} style={{ background: "var(--color-bg-card)" }} />
        ))}
      </div>
    </div>
  );
}

function CalendarError({ message }: { message: string }) {
  return (
    <div
      className="sp-group"
      style={{
        padding: 24,
        color: "var(--color-error)",
        fontSize: "var(--text-sm)",
      }}
    >
      ⚠ 캘린더 데이터를 불러오지 못했습니다: {message}
    </div>
  );
}

function NoProjectSelected() {
  return (
    <div
      className="sp-empty"
      style={{
        padding: "48px 24px",
        textAlign: "center",
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-card)",
      }}
    >
      <div className="sp-empty-icon">📁</div>
      <div className="sp-empty-title">프로젝트를 선택해 주세요</div>
      <div className="sp-empty-desc">
        상단 프로젝트 선택기에서 프로젝트를 고르면 캘린더가 표시됩니다.
      </div>
    </div>
  );
}
