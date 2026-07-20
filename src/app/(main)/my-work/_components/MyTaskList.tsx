"use client";

/**
 * MyTaskList — 내 업무 통합 리스트(B)
 *
 * 요구사항(분석)/단위업무/화면/기능 중 내가 담당자인 것 전부를 마감 임박 순으로 한 리스트에.
 * 행 스타일은 pm/_components/DeadlineListCard.tsx 를 참고(D-day 배지 + 이름 + 진척률,
 * 링크 색은 검정) — 여기선 유형이 섞이므로 D-day 배지 옆에 유형 배지를 하나 더 붙인다.
 */

import { useState } from "react";
import Link from "next/link";
import { MY_WORK_KIND_LABELS } from "@/types/myWork";
import type { MyWorkItem, MyWorkItemKind } from "@/types/myWork";
import type { StatFilter } from "./MyWorkSummary";

type Props = {
  items:     MyWorkItem[];
  isLoading: boolean;
  error:     Error | null;
  /** 요약 카드의 지연/임박 타일 클릭으로 걸린 필터 — page.tsx가 소유, null이면 전체 표시 */
  statFilter?: StatFilter;
  onClearStatFilter?: () => void;
};

// 행 그리드 열 고정폭 — 글자 수(예: "D+85" vs "마감 없음")가 달라도 모든 행에서 동일한
// 위치에 열이 오도록 픽셀 고정값을 쓴다("auto"는 행마다 독립 계산돼 들쭉날쭉해짐).
// 유형/D-day를 배지(테두리·배경)에서 색글자로 바꾸면서 폭도 줄여 이름 칸에 공간을 더 준다.
const ROW_COLS = { kind: "48px", dday: "56px", date: "78px", progress: "168px" };

export default function MyTaskList({ items, isLoading, error, statFilter, onClearStatFilter }: Props) {
  const [helpOpen, setHelpOpen] = useState(false);

  // 요약 카드의 지연/임박 타일 클릭 필터 — dDay 기준은 pm 대시보드 위젯들과 동일(지연: dDay<0, 임박: 0~3)
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
            {visibleItems.map((it) => (
              <li key={`${it.kind}-${it.id}`} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
                <Link
                  href={it.href}
                  style={{
                    // 열 너비를 고정값으로 줘야 행마다 정렬이 맞음 — "auto"면 행(Link)마다 grid가
                    // 독립적이라 배지 글자 수에 따라 열 폭이 행마다 달라져 들쭉날쭉해 보였음.
                    display: "grid", gridTemplateColumns: `${ROW_COLS.kind} ${ROW_COLS.dday} ${ROW_COLS.date} 1fr ${ROW_COLS.progress}`, gap: 8,
                    padding: "6px 14px", textDecoration: "none", color: "var(--color-text-primary)",
                    alignItems: "center", whiteSpace: "nowrap",
                  }}
                >
                  <KindBadge kind={it.kind} />
                  <DDayBadge dDay={it.dDay} />
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
                    {it.endDate ?? "-"}
                  </span>

                  <span
                    style={{ minWidth: 0, fontSize: "var(--text-md)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}
                    title={it.name}
                  >
                    {it.name || "(이름 없음)"}
                  </span>

                  <ProgressCell progress={it.progress} designProgress={it.designProgress} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {helpOpen && <TaskListHelpModal onClose={() => setHelpOpen(false)} />}
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
              마감일이 기준일에 가까운 순(dDay 오름차순). 마감일 없으면 맨 뒤.
            </div>
          </div>

          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>진척률</div>
            <div style={{ color: "var(--color-text-secondary)" }}>
              요구사항 — 값 하나(분석 진척률)<br />
              단위업무·화면·기능 — 설계·구현 두 값 다 표시(각각 design_rt/impl_rt 롤업)<br />
              완료 제외 판정은 구현 값 기준
            </div>
          </div>

          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>완료 제외 / 기준일</div>
            <div style={{ color: "var(--color-text-secondary)" }}>
              완료 제외 — 구현 진척률 100% 항목 숨김(기본 켜짐)<br />
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

// 진척률 셀 — 요구사항(분석)은 값 하나, 단위업무/화면/기능은 설계·구현 둘 다 라벨과 함께 보여준다.
// "화면(설계)"와 "기능(구현)"이 같은 숫자 컬럼에 서로 다른 기준으로 찍혀서 헷갈린다는 피드백으로,
// 어느 값인지 라벨을 항상 붙여 둘 다 노출한다(사용자 피드백).
function ProgressCell({ progress, designProgress }: { progress: number; designProgress: number | null }) {
  if (designProgress === null) {
    return <span style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: "var(--text-md)", color: progressColor(progress) }}>{progress}%</span>;
  }
  return (
    <span style={{ textAlign: "right", fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>
      설계 <span style={{ fontFamily: "var(--font-mono)", color: progressColor(designProgress) }}>{designProgress}%</span>
      {" / "}
      구현 <span style={{ fontFamily: "var(--font-mono)", color: progressColor(progress) }}>{progress}%</span>
    </span>
  );
}

function progressColor(value: number): string {
  if (value === 0) return "var(--color-error)";
  if (value < 50)  return "var(--color-warning)";
  return "var(--color-text-primary)";
}

// D-day — pm 위젯들과 동일한 톤(지연=error, D-0~3=warning, D-4~7=info), 색글자로만 구분
function DDayBadge({ dDay }: { dDay: number | null }) {
  const { label, color } = formatDDay(dDay);
  return (
    <span style={{ fontSize: "var(--text-sm)", color, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function formatDDay(d: number | null): { label: string; color: string } {
  if (d === null) return { label: "마감 없음", color: "var(--color-text-tertiary)" };
  if (d < 0)      return { label: `D+${-d}`, color: "var(--color-error)" };
  if (d === 0)    return { label: "D-DAY",   color: "var(--color-warning)" };
  if (d <= 3)     return { label: `D-${d}`,  color: "var(--color-warning)" };
  if (d <= 7)     return { label: `D-${d}`,  color: "var(--color-info)" };
  return            { label: `D-${d}`,  color: "var(--color-text-tertiary)" };
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
