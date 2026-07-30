"use client";

/**
 * CalendarPage — 캘린더 대시보드 (URL: /calendar)
 *
 * 역할:
 *   - 프로젝트 설정(일정 탭)의 단계일정·마일스톤·공휴일 + 요구사항/단위업무 설계/화면 구현
 *     일정을 월간 그리드에 배치(2026-07-29 확장 — 원래는 단위업무 종료일만 보여줬음)
 *   - 상단 체크박스(관리: 단계일정/마일스톤/공휴일, 업무: 요구사항/단위업무 설계/화면 구현)로
 *     보이는 카테고리를 고른다 — 새 쿼리 없이 이미 받아온 이벤트를 클라이언트에서 필터만 함
 *   - 이전/다음 달 네비게이션 + "오늘로" 버튼
 *   - 본인 담당만 필터 토글(담당자 개념이 없는 단계일정/마일스톤/공휴일은 이 필터와 무관하게 항상 표시)
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
import type { CalendarResponse, CalendarEventCategory } from "@/types/calendar";

import MonthGrid from "./_components/MonthGrid";

const STALE_TIME_MS = 60 * 1000;

// 상단 체크박스 — 관리(프로젝트 전역 일정) / 업무(항목별 일정) 두 그룹.
// "관리"는 기본 전부 켜짐(기존에도 늘 보이던 성격의 정보), "업무"는 기본 꺼짐(사용자 확정 —
// 처음 열었을 때 캘린더가 항목으로 뒤덮이지 않도록, 필요할 때만 체크해서 봄).
type CategoryGroup = { groupLabel: string; items: { category: CalendarEventCategory; label: string }[] };

const CATEGORY_GROUPS: CategoryGroup[] = [
  {
    groupLabel: "관리",
    items: [
      { category: "PHASE",     label: "단계일정" },
      { category: "MILESTONE", label: "마일스톤" },
      { category: "HOLIDAY",   label: "공휴일" },
    ],
  },
  {
    groupLabel: "업무",
    items: [
      { category: "REQUIREMENT",      label: "요구사항" },
      { category: "UNIT_WORK_DESIGN", label: "단위업무 설계" },
      { category: "SCREEN_IMPL",      label: "화면 구현" },
    ],
  },
];

const DEFAULT_CATEGORIES: CalendarEventCategory[] = ["PHASE", "MILESTONE", "HOLIDAY"];

// 헤더 요약칩(전체/완료/지연)은 "업무" 3종 중 이 달에 종료일이 있는 항목만 집계 —
// 단계일정/마일스톤/공휴일은 진행률 개념이 없어 완료·지연 판정 대상이 아님.
const WORK_CATEGORIES: CalendarEventCategory[] = ["REQUIREMENT", "UNIT_WORK_DESIGN", "SCREEN_IMPL"];

export default function CalendarPage() {
  const currentProjectId = useAppStore((s) => s.currentProjectId);

  // 현재 보고 있는 월 — { year, month(1~12) }
  const [view, setView] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });

  // 본인 담당만 필터
  const [myOnly, setMyOnly] = useState(false);

  // 카테고리 체크박스 — 기본값은 "관리" 그룹만 켜짐
  const [selectedCategories, setSelectedCategories] = useState<Set<CalendarEventCategory>>(
    () => new Set(DEFAULT_CATEGORIES)
  );

  function toggleCategory(category: CalendarEventCategory) {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category); else next.add(category);
      return next;
    });
  }

  function toggleGroup(group: CategoryGroup) {
    const allOn = group.items.every((it) => selectedCategories.has(it.category));
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      for (const it of group.items) {
        if (allOn) next.delete(it.category); else next.add(it.category);
      }
      return next;
    });
  }

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

  // 합산 통계 — 헤더 옆 표시용. "업무" 카테고리 중 이 달에 종료 이벤트가 있는 항목만 집계
  // (원래도 종료일 기준으로만 완료/지연을 판정했음 — 시작 이벤트만 있는 항목은 아직 판단 대상 아님).
  const summary = useMemo(() => {
    const events = data?.events ?? [];
    const todayStr = new Date().toISOString().slice(0, 10);
    const endEvents = events.filter((e) =>
      WORK_CATEGORIES.includes(e.category) &&
      selectedCategories.has(e.category) &&
      (!myOnly || e.isMine !== false) &&
      e.label.endsWith("종료")
    );
    const completed = endEvents.filter((e) => (e.progress ?? 0) >= 100).length;
    const overdue   = endEvents.filter((e) => e.date < todayStr && (e.progress ?? 0) < 100).length;
    return { total: endEvents.length, completed, overdue };
  }, [data, selectedCategories, myOnly]);

  return (
    <div style={{ padding: 0 }}>
      {/* 헤더 — 월 네비 + 통계 + 필터 + 카테고리 체크박스. 스크롤해도 항상 보이도록 통째로 sticky. */}
      <div
        style={{
          position: "sticky", top: 0, zIndex: 10,
          background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 24px", gap: 12,
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

        {/* 카테고리 체크박스 — 관리/업무 두 그룹, 그룹 대표 체크박스로 일괄 on/off */}
        <div style={{ display: "flex", gap: 20, padding: "0 24px 10px", flexWrap: "wrap" }}>
          {CATEGORY_GROUPS.map((group) => {
            const allOn = group.items.every((it) => selectedCategories.has(it.category));
            return (
              <div key={group.groupLabel} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <label className="sp-checkbox-wrap" style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--color-text-primary)" }}>
                  <input className="sp-checkbox" type="checkbox" checked={allOn} onChange={() => toggleGroup(group)} />
                  <span>{group.groupLabel}</span>
                </label>
                <div style={{ display: "flex", gap: 12 }}>
                  {group.items.map((it) => (
                    <label key={it.category} className="sp-checkbox-wrap" style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                      <input
                        className="sp-checkbox"
                        type="checkbox"
                        checked={selectedCategories.has(it.category)}
                        onChange={() => toggleCategory(it.category)}
                      />
                      <span>{it.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
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
              events={data?.events ?? []}
              selectedCategories={selectedCategories}
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
      <LegendDot color="var(--color-brand)"   label="📌 마일스톤" />
      <LegendDot color="var(--color-info)"    label="🔍 분석" />
      <LegendDot color="var(--color-accent)"  label="✏️ 설계" />
      <LegendDot color="var(--color-success)" label="🛠️ 구현" />
      <LegendDot color="var(--color-warning)" label="🧪 테스트" />
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
      <span>
        공휴일은 <span
          style={{
            display: "inline-block",
            width: 16, height: 16,
            background: "var(--color-error-subtle)",
            border: "1px solid var(--color-error-border)",
            borderRadius: "var(--radius-sm)",
            verticalAlign: "middle",
            marginLeft: 4,
          }}
        /> 배경으로 표시
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
