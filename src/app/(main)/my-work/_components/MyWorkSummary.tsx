"use client";

/**
 * MyWorkSummary — 내 업무 요약(A) + 진척 요약(D)
 *
 * 역할:
 *   - 상단 스탯 4개: 담당 전체 / 지연 / 임박(D-3 이내) / 하위 담당자 미지정
 *   - 하단: 내가 담당한 요구사항(분석)/단위업무/화면/기능 각각의 평균 진척률 막대
 *     (건수 0이면 "-" — 0%와 구분)
 */

import { useEffect, useRef, useState } from "react";
import type { MyWorkResponse } from "@/types/myWork";
import type { ProgressKind } from "@/types/pm";
import { PROGRESS_KIND_LABELS } from "@/types/pm";

export type StatFilter = "OVERDUE" | "DUE_SOON" | null;

type Props = {
  summary:         MyWorkResponse["summary"] | undefined;
  progressSummary: MyWorkResponse["progressSummary"] | undefined;
  /** 구현/설계 스위치의 최초 기본값(서버가 프로젝트 계획설계 종료일 기준으로 계산) — 로딩 전엔 undefined */
  recommendedPhase: MyWorkResponse["recommendedPhase"] | undefined;
  isLoading: boolean;
  error:     Error | null;
  /** "지연"/"임박" 타일 클릭 시 아래 내 업무 리스트를 필터링하기 위한 상태 — page.tsx가 소유 */
  statFilter: StatFilter;
  onStatFilterChange: (next: StatFilter) => void;
  /** "하위 담당자 미지정" 타일 클릭 시 해당 리스트로 스크롤 이동 */
  onJumpToUnassigned: () => void;
};

// 설계 기간 중엔 설계가, 지나면 구현이 궁금한 게 자연스럽다는 피드백으로 설계를 앞에 둠(2026-07-30)
const PROGRESS_KIND_ORDER: ProgressKind[] = ["DESIGN", "IMPL"];

// 단위업무/화면/기능 — 구현·설계 스위치로 값이 바뀌는 행
const SWITCHABLE_ROWS: { key: "unitWork" | "screen" | "function"; label: string }[] = [
  { key: "unitWork", label: "단위업무" },
  { key: "screen",   label: "화면" },
  { key: "function", label: "기능" },
];

export default function MyWorkSummary({ summary, progressSummary, recommendedPhase, isLoading, error, statFilter, onStatFilterChange, onJumpToUnassigned }: Props) {
  const [helpOpen, setHelpOpen] = useState(false);
  // 분석은 구현/설계 구분이 없어 스위치 대상이 아님 — 단위업무/화면/기능 3개만 이 스위치를 따른다.
  const [progressKind, setProgressKind] = useState<ProgressKind>("IMPL");
  // recommendedPhase는 데이터가 도착한 후에야 값이 생기므로, 최초 1회만 적용하고 그 뒤로는
  // (asOf 변경 등으로 값이 바뀌어도) 사용자가 고른 탭을 덮어쓰지 않는다.
  const appliedDefaultRef = useRef(false);
  useEffect(() => {
    if (!appliedDefaultRef.current && recommendedPhase) {
      setProgressKind(recommendedPhase);
      appliedDefaultRef.current = true;
    }
  }, [recommendedPhase]);

  return (
    <div className="sp-group">
      <div className="sp-group-header">
        <div className="sp-group-title">
          <SummaryIcon />
          요약
        </div>
        <button onClick={() => setHelpOpen(true)} title="계산 기준" style={helpBtnStyle}>?</button>
      </div>
      <div className="sp-group-body">
        {isLoading ? (
          <div style={{ padding: 8, color: "var(--color-text-tertiary)", fontSize: "var(--text-lg)" }}>불러오는 중...</div>
        ) : error ? (
          <div style={{ padding: 8, color: "var(--color-error)", fontSize: "var(--text-lg)" }}>⚠ {error.message}</div>
        ) : !summary || !progressSummary ? null : (
          <>
            {/* 스탯 타일 4개 — 지연/임박/하위 담당자 미지정은 클릭하면 아래 리스트를 필터링·스크롤한다 */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 18 }}>
              <StatTile
                label="담당 전체" value={summary.totalMine}
                active={statFilter === null}
                onClick={() => onStatFilterChange(null)}
              />
              <StatTile
                label="지연" value={summary.overdueCount}
                tone={summary.overdueCount > 0 ? "var(--color-error)" : undefined}
                active={statFilter === "OVERDUE"}
                onClick={() => onStatFilterChange(statFilter === "OVERDUE" ? null : "OVERDUE")}
              />
              <StatTile
                label="임박(D-3 이내)" value={summary.dueSoonCount}
                tone={summary.dueSoonCount > 0 ? "var(--color-warning)" : undefined}
                active={statFilter === "DUE_SOON"}
                onClick={() => onStatFilterChange(statFilter === "DUE_SOON" ? null : "DUE_SOON")}
              />
              <StatTile
                label="하위 담당자 미지정" value={summary.unassignedChildrenCount}
                tone={summary.unassignedChildrenCount > 0 ? "var(--color-error)" : undefined}
                onClick={onJumpToUnassigned}
              />
            </div>
            {/* 클리어 동작은 위 "담당 전체" 타일(클릭)과 아래 리스트 헤더의 "×"가 이미 제공 —
                여기 별도 버튼을 또 두면 같은 기능이 세 군데(타일/여기/리스트 헤더)로 중복돼 뺐다. */}
            {statFilter && (
              <div style={{ marginTop: -10, marginBottom: 14 }}>
                <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-tertiary)" }}>
                  내 업무 리스트에 {statFilter === "OVERDUE" ? "지연" : "임박"} 항목만 표시 중
                </span>
              </div>
            )}

            {/* 진척 요약 막대 — 분석 1개(고정) + 단위업무/화면/기능 3개(구현·설계 스위치) */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--color-text-secondary)" }}>진척 요약</span>
              <div style={{ display: "flex", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
                {PROGRESS_KIND_ORDER.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setProgressKind(k)}
                    style={{
                      padding: "3px 10px", fontSize: "var(--text-base)", fontWeight: 600,
                      border: "none", cursor: "pointer",
                      background: progressKind === k ? "var(--color-brand)" : "var(--color-bg-card)",
                      color: progressKind === k ? "#fff" : "var(--color-text-secondary)",
                    }}
                  >
                    {PROGRESS_KIND_LABELS[k]}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <ProgressRow label="분석(요구사항)" value={progressSummary.analysis} />
              {SWITCHABLE_ROWS.map(({ key, label }) => (
                <ProgressRow key={key} label={label} value={progressSummary[key][progressKind === "IMPL" ? "impl" : "design"]} />
              ))}
            </div>
          </>
        )}
      </div>

      {helpOpen && <SummaryHelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

// ── 계산 기준 도움말 팝업 — pm/_components 의 여러 HelpModal과 같은 톤 ──────────
function SummaryHelpModal({ onClose }: { onClose: () => void }) {
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
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>요약 계산 기준</span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--color-text-secondary)", padding: "0 4px", lineHeight: 1 }}
          >×</button>
        </div>

        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12, fontSize: 13, lineHeight: 1.7, color: "var(--color-text-primary)" }}>
          <div style={{ color: "var(--color-text-secondary)" }}>
            "내 것" = 담당자가 나인 요구사항·단위업무·화면·기능. dDay = 마감일 − 기준일.
          </div>

          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>스탯 4개</div>
            <div style={{ color: "var(--color-text-secondary)" }}>
              담당 전체 — 4개 엔티티 합계<br />
              지연 — dDay &lt; 0<br />
              임박 — 0 ≤ dDay ≤ 3<br />
              하위 담당자 미지정 — "하위 담당자 미지정" 카드 건수
            </div>
          </div>

          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>진척 요약 막대 4개 — 각 항목 진척률의 평균</div>
            <div style={{ color: "var(--color-text-secondary)" }}>
              분석(요구사항) — 요구사항 진척률의 평균(구현/설계 구분 없음)<br />
              단위업무·화면·기능 — 상단 구현/설계 스위치로 선택한 값의 평균(둘 다 기능의 impl_rt/design_rt 롤업)<br />
              "-" — 담당 항목 없음(0%와 다름)
            </div>
          </div>

          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>막대 색상</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, color: "var(--color-text-secondary)" }}>
              <div><span style={legendDotStyle("var(--color-success)")} /> 100% — 완료</div>
              <div><span style={legendDotStyle("var(--color-info)")} /> 1~99% — 진행중</div>
              <div><span style={legendDotStyle("var(--color-error)")} /> 0% — 미착수</div>
              <div><span style={legendDotStyle("var(--color-border-subtle)")} /> 회색 — 담당 항목 없음</div>
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

function ProgressRow({ label, value }: { label: string; value: number | null }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ width: 100, flexShrink: 0, fontSize: "var(--text-lg)", color: "var(--color-text-secondary)" }}>{label}</span>
      <div style={{ flex: 1, height: 8, background: "var(--color-border-subtle)", borderRadius: "var(--radius-full)", overflow: "hidden" }}>
        <div style={{ width: `${value ?? 0}%`, height: "100%", background: progressTone(value), opacity: 0.55, transition: "width 200ms ease" }} />
      </div>
      <span style={{ width: 40, textAlign: "right", flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: "var(--text-lg)", fontWeight: 600, color: "var(--color-text-primary)" }}>
        {value === null ? "-" : `${value}%`}
      </span>
    </div>
  );
}

function StatTile({ label, value, tone, active, onClick }: { label: string; value: number; tone?: string; active?: boolean; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      style={{
        display: "block", width: "100%", textAlign: "left", padding: "10px 12px",
        background: active ? "var(--color-brand-subtle, var(--color-bg-elevated))" : "var(--color-bg-elevated)",
        borderRadius: "var(--radius-md)",
        border: `1px solid ${active ? "var(--color-brand)" : "var(--color-border-subtle)"}`,
        cursor: onClick ? "pointer" : "default", font: "inherit",
      }}
    >
      <div style={{ fontSize: "var(--text-base)", color: "var(--color-text-tertiary)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: "var(--text-2xl)", fontWeight: 700, fontFamily: "var(--font-mono)", color: tone ?? "var(--color-text-primary)", opacity: tone ? 0.82 : 1 }}>{value}</div>
    </Tag>
  );
}

// 도움말 팝업의 색상 범례용 작은 점 — sp-badge 의 .dot 과 같은 시각 언어
function legendDotStyle(color: string): React.CSSProperties {
  return {
    display: "inline-block", width: 9, height: 9, borderRadius: "var(--radius-full)",
    background: color, marginRight: 6, verticalAlign: "middle",
  };
}

// 완료(100%)만 성공색, 그 외 진행 중(1~99%)은 굳이 경고톤을 쓰지 않고 은은한 파란색(진행중) —
// 진척률이 낮다고 무조건 "위험"은 아니라서(지연 여부는 dDay가 따로 알려줌) 색으로 겁줄 필요 없음.
function progressTone(value: number | null): string {
  if (value === null) return "var(--color-border-subtle)";
  if (value >= 100) return "var(--color-success)";
  if (value > 0) return "var(--color-info)";
  return "var(--color-error)";
}

function SummaryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}
