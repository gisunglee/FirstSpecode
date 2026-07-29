"use client";

/**
 * HelpButton — 카드/위젯 헤더에 붙는 "?" 도움말 버튼 + 설명 모달
 *
 * 역할:
 *   - 헤더에 작은 "?" 버튼만 노출, 클릭 시 title + children(설명 내용)을 모달로 표시
 *   - PM 진단(TeamLoadMatrix.tsx 등)에 동일한 "?" 버튼 + 오버레이 패턴이 여러 곳
 *     복붙돼 있던 것을 공용 컴포넌트로 추출 — 대시보드 카드들부터 이 컴포넌트를 쓴다
 *     (기존 PM 진단 3곳은 이번 범위 밖이라 그대로 둠)
 *
 * 사용 예:
 *   <HelpButton title="마감 임박 기준">
 *     <p>단위업무는 종료일, 화면은 설계 종료일, 기능은 구현 종료일 기준입니다.</p>
 *   </HelpButton>
 */

import { useState } from "react";
import type { ReactNode } from "react";

type Props = {
  title:    string;
  children: ReactNode;
};

export default function HelpButton({ title, children }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={title}
        aria-label={title}
        style={helpBtnStyle}
      >
        ?
      </button>

      {open && (
        <div
          style={overlayStyle}
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            style={dialogStyle}
          >
            <div style={headerStyle}>
              <span style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>
                {title}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={closeBtnStyle}
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <div style={bodyStyle}>{children}</div>
          </div>
        </div>
      )}
    </>
  );
}

const helpBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 18, height: 18, borderRadius: "50%",
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)", fontSize: 12, fontWeight: 700,
  cursor: "pointer", lineHeight: 1, padding: 0, flexShrink: 0,
};

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100,
};

const dialogStyle: React.CSSProperties = {
  width: "min(520px, 90vw)",
  background: "var(--color-bg-card)",
  borderRadius: 12,
  boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
  overflow: "hidden",
  border: "1px solid var(--color-border)",
};

const headerStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "14px 20px", borderBottom: "1px solid var(--color-border)",
  background: "var(--color-bg-muted)",
};

const closeBtnStyle: React.CSSProperties = {
  background: "none", border: "none", fontSize: 20, cursor: "pointer",
  color: "var(--color-text-secondary)", padding: "0 4px", lineHeight: 1,
};

const bodyStyle: React.CSSProperties = {
  padding: "18px 20px",
  display: "flex", flexDirection: "column", gap: 12,
  fontSize: "var(--text-base)", lineHeight: 1.7, color: "var(--color-text-secondary)",
};
