"use client";

/**
 * UnassignedChildrenList — 하위 담당자 미지정(C)
 *
 * 내가 담당하는 요구사항/단위업무/화면의 직속 자식 중 담당자가 없는 것.
 * "내 요구사항 밑에 담당자 없는 단위업무가 있다" 같은 사각지대를 놓치지 않기 위한 리스트 —
 * 영역(Area)은 담당자 개념이 없어(기존 관례) 화면→기능으로 바로 건너뛴다.
 */

import { useState } from "react";
import Link from "next/link";
import { MY_WORK_KIND_LABELS } from "@/types/myWork";
import type { UnassignedChildItem } from "@/types/myWork";

type Props = {
  items:     UnassignedChildItem[];
  isLoading: boolean;
  error:     Error | null;
};

export default function UnassignedChildrenList({ items, isLoading, error }: Props) {
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <div className="sp-group" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div className="sp-group-header">
        <div className="sp-group-title">
          <WarningIcon />
          하위 담당자 미지정
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: "var(--text-base)", color: items.length > 0 ? "var(--color-error)" : "var(--color-text-tertiary)" }}>{items.length}건</span>
          <button onClick={() => setHelpOpen(true)} title="판정 기준" style={helpBtnStyle}>?</button>
        </div>
      </div>
      <div
        style={{
          padding: "6px 16px", fontSize: "var(--text-base)", color: "var(--color-text-tertiary)",
          borderBottom: "1px solid var(--color-border-subtle)",
        }}
      >
        내 요구사항→담당자 없는 단위업무 · 내 단위업무→담당자 없는 화면 · 내 화면→담당자 없는 기능(영역 제외)
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        {isLoading ? (
          <Skeleton />
        ) : error ? (
          <div style={{ padding: 16, color: "var(--color-error)", fontSize: "var(--text-lg)" }}>⚠ {error.message}</div>
        ) : items.length === 0 ? (
          <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "var(--text-lg)" }}>
            🎉 담당자 없는 하위 항목이 없습니다.
          </div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {items.map((it) => (
              <li key={`${it.childKind}-${it.id}`} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
                <Link
                  href={it.href}
                  style={{
                    display: "flex", flexDirection: "column", gap: 2,
                    padding: "9px 14px", textDecoration: "none", color: "var(--color-text-primary)",
                  }}
                >
                  <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {MY_WORK_KIND_LABELS[it.parentKind]} &ldquo;{it.parentName}&rdquo; 하위
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="sp-badge sp-badge-error" style={{ fontSize: "var(--text-base)", padding: "1px 6px" }}>
                      {MY_WORK_KIND_LABELS[it.childKind]}
                    </span>
                    <span style={{ fontSize: "var(--text-lg)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={it.name}>
                      {it.name || "(이름 없음)"}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {helpOpen && <UnassignedHelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

// ── 판정 기준 도움말 팝업 ────────────────────────────────────────────────────
function UnassignedHelpModal({ onClose }: { onClose: () => void }) {
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
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>하위 담당자 미지정 판정 기준</span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--color-text-secondary)", padding: "0 4px", lineHeight: 1 }}
          >×</button>
        </div>

        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12, fontSize: 13, lineHeight: 1.7, color: "var(--color-text-primary)" }}>
          <div style={{ color: "var(--color-text-secondary)" }}>
            내가 담당하는 것의 <b>직속 자식</b>만 대상(손자뻘은 안 봄).
          </div>

          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>부모 → 자식</div>
            <div style={{ color: "var(--color-text-secondary)" }}>
              내 요구사항 → 담당자 없는 단위업무<br />
              내 단위업무 → 담당자 없는 화면<br />
              내 화면 → 담당자 없는 기능(영역은 담당자 개념 없어 건너뜀)
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
        <div key={i} style={{ height: 40, background: "var(--color-bg-elevated)", borderRadius: "var(--radius-sm)", opacity: 0.5 }} />
      ))}
    </div>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
