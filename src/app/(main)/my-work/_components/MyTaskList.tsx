"use client";

/**
 * MyTaskList — 내 업무 통합 리스트(B)
 *
 * 요구사항(분석)/단위업무/화면/기능 중 내가 담당자인 것 전부를 마감 임박 순으로 한 리스트에.
 * 행 스타일은 pm/_components/DeadlineListCard.tsx 를 참고(마감일 + 이름 + 진척률,
 * 링크 색은 검정) — 여기선 유형이 섞이므로 마감일 옆에 유형 배지를 하나 더 붙인다.
 *
 * 구현/설계 스위치(phase) — 단위업무·화면·기능은 마감일·진척률이 설계/구현 두 축이라, 예전엔
 * 한 행에 "설계 X / 구현 Y"를 둘 다 나란히 찍었는데 D-day까지 겹치니 정신없다는 피드백으로
 * 뺐다. 대신 리스트 전체에 적용되는 토글 하나로 "지금 보고 있는 축"을 고정하고, 행은 그 축의
 * 마감일 하나 + 진척률 하나만 보여준다. 요구사항(분석)은 그 축 구분이 없어 토글과 무관하게
 * 항상 분석 마감일·진척률을 보여준다.
 */

import { useState } from "react";
import Link from "next/link";
import { MY_WORK_KIND_LABELS } from "@/types/myWork";
import type { MyWorkItem, MyWorkItemKind } from "@/types/myWork";
import type { StatFilter } from "./MyWorkSummary";

type Phase = "IMPL" | "DESIGN";

type Props = {
  items:     MyWorkItem[];
  isLoading: boolean;
  error:     Error | null;
  /** 요약 카드의 지연/임박 타일 클릭으로 걸린 필터 — page.tsx가 소유, null이면 전체 표시 */
  statFilter?: StatFilter;
  onClearStatFilter?: () => void;
};

// 행 그리드 열 고정폭 — 글자 수가 달라도 모든 행에서 동일한 위치에 열이 오도록 픽셀
// 고정값을 쓴다("auto"는 행마다 독립 계산돼 들쭉날쭉해짐).
const ROW_COLS = { kind: "48px", date: "96px", progress: "56px" };

// 단위업무/화면/기능의 마감일·진척률에서 현재 phase에 해당하는 값만 골라낸다.
// 요구사항은 designProgress가 null(설계라는 축 자체가 없음)이라 phase와 무관하게 항상 분석 값.
function resolvePhaseValue(it: MyWorkItem, phase: Phase): { date: string | null; dDay: number | null; progress: number } {
  if (it.designProgress === null) {
    return { date: it.endDate, dDay: it.dDay, progress: it.progress };
  }
  return phase === "DESIGN"
    ? { date: it.designEndDate, dDay: it.designDDay, progress: it.designProgress }
    : { date: it.endDate, dDay: it.dDay, progress: it.progress };
}

export default function MyTaskList({ items, isLoading, error, statFilter, onClearStatFilter }: Props) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("IMPL");

  // 요약 카드의 지연/임박 타일 클릭 필터 — dDay 기준은 pm 대시보드 위젯들과 동일(지연: dDay<0, 임박: 0~3)
  // 필터 자체는 phase 토글과 무관하게 항상 구현/분석 dDay(it.dDay) 기준(요약 카드 집계와 동일 기준 유지).
  const visibleItems = !statFilter
    ? items
    : items.filter((it) => it.dDay !== null && (statFilter === "OVERDUE" ? it.dDay < 0 : it.dDay >= 0 && it.dDay <= 3));

  return (
    <div className="sp-group" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div className="sp-group-header">
        <div className="sp-group-title">
          <ListIcon />
          내 업무 리스트
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {statFilter && (
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "var(--text-base)", color: "var(--color-brand)" }}>
              {statFilter === "OVERDUE" ? "지연" : "임박"}만
              <button
                type="button"
                onClick={onClearStatFilter}
                title="필터 해제"
                style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: "var(--text-base)", padding: 0, lineHeight: 1 }}
              >×</button>
            </span>
          )}
          <PhaseToggle phase={phase} onChange={setPhase} />
          <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-tertiary)" }}>{visibleItems.length}건</span>
          <button onClick={() => setHelpOpen(true)} title="정렬·진척률 기준" style={helpBtnStyle}>?</button>
        </div>
      </div>
      <div style={{ maxHeight: 520, overflowY: "auto" }}>
        {isLoading ? (
          <Skeleton />
        ) : error ? (
          <div style={{ padding: 16, color: "var(--color-error)", fontSize: "var(--text-lg)" }}>⚠ {error.message}</div>
        ) : visibleItems.length === 0 ? (
          <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "var(--text-lg)" }}>
            🎉 {statFilter ? "해당하는 업무가 없습니다." : "담당한 업무가 없습니다."}
          </div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {visibleItems.map((it) => {
              const v = resolvePhaseValue(it, phase);
              return (
                <li key={`${it.kind}-${it.id}`} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
                  <Link
                    href={it.href}
                    style={{
                      // 열 너비를 고정값으로 줘야 행마다 정렬이 맞음 — "auto"면 행(Link)마다 grid가
                      // 독립적이라 글자 수에 따라 열 폭이 행마다 달라져 들쭉날쭉해 보였음.
                      display: "grid", gridTemplateColumns: `${ROW_COLS.kind} ${ROW_COLS.date} 1fr ${ROW_COLS.progress}`, gap: 8,
                      padding: "6px 14px", textDecoration: "none", color: "var(--color-text-primary)",
                      alignItems: "center", whiteSpace: "nowrap",
                    }}
                  >
                    <KindBadge kind={it.kind} />
                    <span style={{ fontSize: "var(--text-sm)", color: dateColor(v.dDay), whiteSpace: "nowrap" }}>
                      {v.date ?? "-"}
                    </span>

                    <span
                      style={{ minWidth: 0, fontSize: "var(--text-md)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}
                      title={it.name}
                    >
                      {it.name || "(이름 없음)"}
                    </span>

                    <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: "var(--text-md)", color: progressColor(v.progress) }}>
                      {v.progress}%
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {helpOpen && <TaskListHelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

// 구현/설계 전환 토글 — 리스트 전체에 적용되는 하나의 스위치. 요구사항 행은 이 값과 무관하게
// 항상 분석 마감일·진척률을 보여준다(그 축 자체가 없어서).
function PhaseToggle({ phase, onChange }: { phase: Phase; onChange: (p: Phase) => void }) {
  return (
    <div style={{ display: "flex", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
      {(["IMPL", "DESIGN"] as const).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          style={{
            padding: "2px 10px", fontSize: "var(--text-sm)", fontWeight: 500, border: "none", cursor: "pointer",
            background: phase === p ? "var(--color-brand)" : "var(--color-bg-card)",
            color:      phase === p ? "var(--color-text-inverse)" : "var(--color-text-secondary)",
          }}
        >
          {p === "IMPL" ? "구현" : "설계"}
        </button>
      ))}
    </div>
  );
}

// ── 정렬·진척률 기준 도움말 팝업 ─────────────────────────────────────────────
function TaskListHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(560px, 90vw)", background: "var(--color-bg-card)", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.2)", overflow: "hidden" }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-muted)",
        }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>내 업무 리스트 기준</span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--color-text-secondary)", padding: "0 4px", lineHeight: 1 }}
          >×</button>
        </div>

        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12, fontSize: 13, lineHeight: 1.7, color: "var(--color-text-primary)" }}>
          <div style={{ color: "var(--color-text-secondary)" }}>
            담당자가 나인 요구사항·단위업무·화면·기능 전부를 유형 배지로 구분해 모은 리스트.
          </div>

          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>정렬</div>
            <div style={{ color: "var(--color-text-secondary)" }}>
              마감일이 기준일에 가까운 순(구현/분석 마감일 오름차순 — 이 순서는 구현·설계 토글과 무관하게 항상 동일).
              마감일 없으면 맨 뒤.
            </div>
          </div>

          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>구현 / 설계 토글</div>
            <div style={{ color: "var(--color-text-secondary)" }}>
              목록 우측 상단 [구현/설계]로 지금 볼 축을 고른다.<br />
              <b>구현</b> — 단위업무(하위 화면 실질구현기간 롤업) · 화면(자신의 실질구현기간) ·
              기능(소속 화면 상속)의 마감일·구현 진척률<br />
              <b>설계</b> — 단위업무(자신의 계획설계기간) · 화면·기능(부모 단위업무 설계기간 상속)의
              마감일·설계 진척률<br />
              요구사항은 설계라는 축이 없어 토글과 무관하게 항상 분석 마감일·진척률만 표시.
            </div>
          </div>

          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>완료 제외 / 기준일</div>
            <div style={{ color: "var(--color-text-secondary)" }}>
              완료 제외 — 구현 진척률 100% 항목 숨김(기본 켜짐, 토글 위치와 무관하게 항상 구현 값 기준)<br />
              기준일 — "오늘"을 다른 날짜로 바꿔서 재계산
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const helpBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 18, height: 18, borderRadius: "50%",
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)", fontSize: 10, fontWeight: 700,
  cursor: "pointer", lineHeight: 1, padding: 0,
};

// 배지(테두리+배경)는 좁은 열에서 답답해 보여 색글자로 바꿈 — sp-badge-* 와 같은 fg 컬러를 그대로 재사용해
// 톤 언어는 유지하되 시각적으로는 더 단순하게.
const KIND_COLOR: Record<MyWorkItemKind, string> = {
  REQUIREMENT: "var(--color-accent)",
  UNIT_WORK:   "var(--color-brand)",
  SCREEN:      "var(--color-info)",
  FUNCTION:    "var(--color-text-secondary)",
};

function KindBadge({ kind }: { kind: MyWorkItemKind }) {
  return (
    <span style={{ fontSize: "var(--text-sm)", color: KIND_COLOR[kind], whiteSpace: "nowrap" }}>
      {MY_WORK_KIND_LABELS[kind]}
    </span>
  );
}

function progressColor(value: number): string {
  if (value === 0) return "var(--color-error)";
  if (value < 50)  return "var(--color-warning)";
  return "var(--color-text-primary)";
}

// 지난 마감(dDay<0)만 빨강으로 — D-day 배지처럼 임박(0~7일) 구간까지 나누면 다시 정신없어지니
// "이미 늦은 것"만 눈에 띄게 최소한으로.
function dateColor(dDay: number | null): string {
  if (dDay !== null && dDay < 0) return "var(--color-error)";
  return "var(--color-text-tertiary)";
}

function Skeleton() {
  return (
    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ height: 36, background: "var(--color-bg-elevated)", borderRadius: "var(--radius-sm)", opacity: 0.5 }} />
      ))}
    </div>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}
