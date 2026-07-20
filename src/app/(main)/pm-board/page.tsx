"use client";

/**
 * PmBoardPage — PM 현황 (URL: /pm-board)
 *
 * 역할:
 *   - "PM 진단"(/pm)과 목적이 다르다 — 진단은 전부 멤버 기준("누가 얼마나 밀렸나")으로 걱정되는
 *     지점을 자세히 파고드는 화면, 현황은 항목 기준("전체적으로 잘 굴러가고 있나")으로 매일
 *     가볍게 훑어보는 목록 위주 안심용 화면.
 *   - 7개 카드: 요구사항 분석 / 단위업무·화면·기능 × 설계·구현. 카드마다 진척률 4구간
 *     도넛(미지정/진행중~50/진행중~99/완료) + 마감 임박 순 표.
 *   - 데이터는 단일 엔드포인트(/api/projects/[id]/pm-board-summary)에서 한 번에.
 *   - 기준일자 스테퍼는 DeadlineListCard.tsx/DeadlineProgressHeatmap.tsx 와 동일한 UI(shiftDateStr).
 *
 * 격리:
 *   - pm/ 폴더(PM 진단)와 완전 분리 — pm-summary 캐시와 무관, 이 페이지 전용 쿼리.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";
import type { PmBoardSummaryResponse, BoardCategoryKind } from "@/types/pm";
import BoardCategoryCard from "./_components/BoardCategoryCard";

const STALE_TIME_MS = 2 * 60 * 1000;

// 카드 표 노출 개수 선택지 — 전체 카드 공유(카드별 개별 선택자 대신 헤더 하나로 통일, 사용자 확정)
const ROW_LIMIT_OPTIONS = [10, 15, 20, 50] as const;
const DEFAULT_ROW_LIMIT = 15;

// 카테고리별 표 계층 컬럼 수 — "화면=단위업무+화면", "기능=단위업무+화면+기능명" (사용자 확정)
const NAME_COLUMNS: Record<BoardCategoryKind, 1 | 2 | 3> = {
  REQUIREMENT_ANALYSIS: 1,
  UNIT_WORK_DESIGN: 1,
  UNIT_WORK_IMPL:   1,
  SCREEN_DESIGN: 2,
  SCREEN_IMPL:   2,
  FUNCTION_DESIGN: 3,
  FUNCTION_IMPL:   3,
};

// 카드 렌더 순서 + 상단 요약칩용 라벨 — pm-board-summary/route.ts 의 categoryDefs 순서·라벨과 동일
const CATEGORY_ORDER: { kind: BoardCategoryKind; label: string }[] = [
  { kind: "REQUIREMENT_ANALYSIS", label: "요구사항 분석" },
  { kind: "UNIT_WORK_DESIGN",     label: "단위업무 설계" },
  { kind: "SCREEN_DESIGN",        label: "화면 설계" },
  { kind: "FUNCTION_DESIGN",      label: "기능 설계" },
  { kind: "UNIT_WORK_IMPL",       label: "단위업무 구현" },
  { kind: "SCREEN_IMPL",          label: "화면 구현" },
  { kind: "FUNCTION_IMPL",        label: "기능 구현" },
];

// 지연 판정 — "마감일이 지났고 완료가 아님"(PM 진단 FormulaHelpModal의 지연 판정과 동일 기준).
// 새 쿼리 없이, 이미 받아온 category.items(각 항목의 dDay/bucket은 서버가 이미 계산해둠)만 필터링.
function countDelayed(category: { items: { dDay: number | null; bucket: string }[] } | undefined): number {
  if (!category) return 0;
  return category.items.filter((it) => it.dDay !== null && it.dDay < 0 && it.bucket !== "DONE").length;
}

function scrollToCard(kind: BoardCategoryKind) {
  document.getElementById(`pm-board-card-${kind}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// yyyy-MM-dd 문자열에 일수를 더하고(음수면 뺀다) 다시 yyyy-MM-dd 로 반환 — DeadlineListCard.tsx 와 동일
function shiftDateStr(dateStr: string, deltaDays: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export default function PmBoardPage() {
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const [asOfDate, setAsOfDate] = useState("");
  const [rowLimit, setRowLimit] = useState<number>(DEFAULT_ROW_LIMIT);
  const displayDate = asOfDate || new Date().toISOString().slice(0, 10);

  const { data, isLoading, error } = useQuery({
    queryKey: ["pm-board-summary", currentProjectId, displayDate],
    queryFn: () =>
      authFetch<{ data: PmBoardSummaryResponse }>(
        `/api/projects/${currentProjectId}/pm-board-summary?asOf=${displayDate}`
      ).then((r) => r.data),
    enabled:   !!currentProjectId,
    staleTime: STALE_TIME_MS,
  });

  // kind → category 조회용 맵 — 카드 렌더 순서(NAME_COLUMNS 키 순서)와 응답 순서를 분리해도 안전하게
  const categoryMap = new Map((data?.categories ?? []).map((c) => [c.kind, c]));

  return (
    <div style={{ padding: 0 }}>
      {/* 헤더 — 타이틀/기준일 행 + 지연 카운트 요약 행. 스크롤해도 항상 보이도록 통째로 sticky. */}
      <div
        style={{
          position: "sticky", top: 0, zIndex: 10,
          background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 24px", gap: 12, flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 19, fontWeight: 700, color: "var(--color-text-primary)" }}>
            🗂️ PM 현황
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            {/* 목록 노출 개수 — 카드 표마다 새 쿼리 없이 이미 받아온 items를 이 개수만큼만 슬라이스.
                도넛/총건수/4구간 분포는 이 값과 무관하게 항상 전체 기준(서버에서 이미 계산됨). */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-secondary)" }}>목록</span>
              {ROW_LIMIT_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRowLimit(n)}
                  style={{
                    ...stepBtnStyle, width: "auto", padding: "0 8px", fontSize: 11, fontWeight: 600,
                    borderColor: rowLimit === n ? "var(--color-brand)" : "var(--color-border)",
                    color: rowLimit === n ? "var(--color-brand)" : "var(--color-text-secondary)",
                    background: rowLimit === n ? "var(--color-bg-muted)" : "var(--color-bg-card)",
                  }}
                >
                  {n}
                </button>
              ))}
            </div>

            {/* 기준일 스테퍼 — 전체 카드가 같은 기준일을 공유(단일 쿼리) */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-secondary)" }}>기준일</span>
              <button type="button" onClick={() => setAsOfDate(shiftDateStr(displayDate, -1))} title="하루 전" style={stepBtnStyle}>−</button>
              <input
                type="date"
                value={displayDate}
                onChange={(e) => setAsOfDate(e.target.value)}
                className="sp-input"
                style={{ padding: "2px 6px", fontSize: "var(--text-base)", height: 26, width: 122 }}
              />
              <button type="button" onClick={() => setAsOfDate(shiftDateStr(displayDate, 1))} title="하루 후" style={stepBtnStyle}>+</button>
              {asOfDate && (
                <button type="button" onClick={() => setAsOfDate("")} title="오늘 기준으로 되돌리기" style={resetBtnStyle}>오늘</button>
              )}
            </div>
          </div>
        </div>

        {/* 지연 카운트 요약 — 아래로 스크롤하지 않아도 7개 카테고리 지연 건수가 한눈에 보이도록.
            새 쿼리 없음 — 이미 받아온 categoryMap 항목을 필터링만 함. 클릭하면 해당 카드로 스크롤. */}
        {currentProjectId && (
          <div style={{ display: "flex", gap: 6, padding: "0 24px 10px", flexWrap: "wrap" }}>
            {CATEGORY_ORDER.map(({ kind, label }) => {
              const count = countDelayed(categoryMap.get(kind));
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => scrollToCard(kind)}
                  title={`${label} 카드로 이동`}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "4px 10px", borderRadius: "var(--radius-sm)",
                    border: `1px solid ${count > 0 ? "var(--color-error)" : "var(--color-border)"}`,
                    background: count > 0 ? "var(--color-bg-card)" : "var(--color-bg-muted)",
                    color: "var(--color-text-secondary)", fontSize: 12, cursor: "pointer",
                  }}
                >
                  <span>{label}</span>
                  <span style={{
                    fontFamily: "var(--font-mono)", fontWeight: 700,
                    color: count > 0 ? "var(--color-error)" : "var(--color-text-tertiary)",
                  }}>
                    {isLoading ? "-" : count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        {!currentProjectId ? (
          <NoProjectSelected />
        ) : (
          <>
            {/* CATEGORY_ORDER 순서대로 카드 렌더 — id는 상단 요약칩의 스크롤 타겟.
                scrollMarginTop은 sticky 헤더(타이틀행+요약행)에 카드 상단이 가리지 않도록. */}
            {CATEGORY_ORDER.map(({ kind }) => (
              <div key={kind} id={`pm-board-card-${kind}`} style={{ scrollMarginTop: 100 }}>
                <BoardCategoryCard
                  category={categoryMap.get(kind)}
                  nameColumns={NAME_COLUMNS[kind]}
                  rowLimit={rowLimit}
                  isLoading={isLoading}
                  error={error as Error | null}
                />
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function NoProjectSelected() {
  return (
    <div
      className="sp-empty"
      style={{
        padding: "48px 24px", textAlign: "center",
        background: "var(--color-bg-card)", border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-card)",
      }}
    >
      <div className="sp-empty-icon">📁</div>
      <div className="sp-empty-title">프로젝트를 선택해 주세요</div>
      <div className="sp-empty-desc">
        상단 프로젝트 선택기에서 프로젝트를 고르면 PM 현황이 표시됩니다.
      </div>
    </div>
  );
}

const stepBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 22, height: 22, borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)", fontSize: 14, fontWeight: 700,
  cursor: "pointer", lineHeight: 1, padding: 0,
};

const resetBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  height: 22, padding: "0 8px", borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)", fontSize: 11, fontWeight: 600,
  cursor: "pointer", lineHeight: 1,
};
