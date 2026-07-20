"use client";

/**
 * MissingScheduleList — 내 업무 미설정(E)
 *
 * 내가 담당한 요구사항/단위업무/화면/기능 중 시작일·종료일·공수 중 하나라도 비어 있는 것.
 * UnassignedChildrenList(하위 담당자 미지정)와 같은 톤의 "가벼운 경고 리스트" —
 * 어떤 필드가 비었는지 칩으로 바로 보여준다.
 * 제목을 "일정/공수 미설정"이 아닌 "내 업무 미설정"으로 두는 이유 — 지금은 시작일/종료일/공수만
 * 검사하지만, 나중에 검사 필드가 늘어나도(예: 담당자 외 다른 필수값) 제목을 또 바꿀 필요가 없도록
 * "내 업무 중 뭔가 미설정"이라는 상위 개념으로 이름을 잡는다.
 */

import { useState } from "react";
import Link from "next/link";
import { MY_WORK_KIND_LABELS } from "@/types/myWork";
import type { MissingScheduleItem } from "@/types/myWork";

type Props = {
  items:     MissingScheduleItem[];
  isLoading: boolean;
  error:     Error | null;
};

export default function MissingScheduleList({ items, isLoading, error }: Props) {
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <div className="sp-group" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div className="sp-group-header">
        <div className="sp-group-title">
          <CalendarWarnIcon />
          내 업무 미설정
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: "var(--text-base)", color: items.length > 0 ? "var(--color-warning)" : "var(--color-text-tertiary)" }}>{items.length}건</span>
          <button onClick={() => setHelpOpen(true)} title="판정 기준" style={helpBtnStyle}>?</button>
        </div>
      </div>
      <div style={{ maxHeight: 260, overflowY: "auto" }}>
        {isLoading ? (
          <Skeleton />
        ) : error ? (
          <div style={{ padding: 16, color: "var(--color-error)", fontSize: "var(--text-lg)" }}>⚠ {error.message}</div>
        ) : items.length === 0 ? (
          <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "var(--text-lg)" }}>
            🎉 일정·공수 빠진 항목이 없습니다.
          </div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {items.map((it) => (
              <li key={`${it.kind}-${it.id}`} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
                <Link
                  href={it.href}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 14px", textDecoration: "none", color: "var(--color-text-primary)",
                  }}
                >
                  <span style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
                    {MY_WORK_KIND_LABELS[it.kind]}
                  </span>
                  <span
                    style={{ flex: 1, minWidth: 0, fontSize: "var(--text-md)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={it.name}
                  >
                    {it.name || "(이름 없음)"}
                  </span>
                  <span style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    {it.missingFields.map((f) => (
                      <span key={f} className="sp-badge sp-badge-warning" style={{ fontSize: "var(--text-sm)", padding: "1px 6px" }}>
                        {f}
                      </span>
                    ))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {helpOpen && <MissingScheduleHelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

// ── 판정 기준 도움말 팝업 ────────────────────────────────────────────────────
function MissingScheduleHelpModal({ onClose }: { onClose: () => void }) {
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
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>내 업무 미설정 판정 기준</span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--color-text-secondary)", padding: "0 4px", lineHeight: 1 }}
          >×</button>
        </div>

        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12, fontSize: 13, lineHeight: 1.7, color: "var(--color-text-primary)" }}>
          <div style={{ color: "var(--color-text-secondary)" }}>
            내가 담당자인 요구사항·단위업무·화면·기능 중, 완료 제외가 켜져 있으면 완료 항목은 뺀다(내 업무 리스트와 동일 기준).
          </div>

          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>검사 필드</div>
            <div style={{ color: "var(--color-text-secondary)" }}>
              시작일·종료일 — 4개 엔티티 전부 대상<br />
              공수 — 화면(설계 공수)·기능(구현 공수)만 대상. 요구사항·단위업무는 공수 필드 자체가 없어 제외
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

function Skeleton() {
  return (
    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ height: 32, background: "var(--color-bg-elevated)", borderRadius: "var(--radius-sm)", opacity: 0.5 }} />
      ))}
    </div>
  );
}

function CalendarWarnIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="12" y1="14" x2="12" y2="17" />
      <line x1="12" y1="19.5" x2="12.01" y2="19.5" />
    </svg>
  );
}
