"use client";

/**
 * ArtifactOptionsDialog — 산출물 다운로드 옵션 선택 다이얼로그
 *
 * 역할:
 *   - PROJECT_ARTIFACTS 의 한 항목에 options 가 정의되어 있을 때, 카드 클릭 시 열리는 모달.
 *   - 옵션 메타데이터를 보고 체크박스를 동적 렌더링 — 새 산출물에 옵션이 추가돼도
 *     본 컴포넌트는 수정 불필요.
 *   - 사용자가 [다운로드] 누르면 선택값을 onConfirm 으로 전달.
 *
 * 도메인 무관:
 *   - props 로 artifact 만 받음. 어떤 산출물이든 재사용 가능.
 *
 * 사용 예:
 *   <ArtifactOptionsDialog
 *     open={!!pendingArtifact}
 *     artifact={pendingArtifact}
 *     onClose={() => setPendingArtifact(null)}
 *     onConfirm={(values) => downloadArtifact(pendingArtifact, values)}
 *   />
 */

import { useEffect, useState } from "react";
import type { ProjectArtifact } from "@/lib/exports/project-artifacts";

type Props = {
  open:       boolean;
  /** open=true 일 때 반드시 non-null. open=false 면 무시. */
  artifact:   ProjectArtifact | null;
  onClose:    () => void;
  onConfirm:  (values: Record<string, boolean>) => void;
};

export default function ArtifactOptionsDialog({
  open, artifact, onClose, onConfirm,
}: Props) {
  // 다이얼로그 내부 상태 — 옵션 키 → 체크 여부.
  // open 이 바뀌거나 artifact 가 교체되면 옵션 default 로 초기화.
  const [values, setValues] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (open && artifact?.options) {
      const init: Record<string, boolean> = {};
      for (const opt of artifact.options) {
        init[opt.key] = opt.defaultValue;
      }
      setValues(init);
    }
  }, [open, artifact]);

  if (!open || !artifact) return null;
  const opts = artifact.options ?? [];

  function toggle(key: string) {
    setValues((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleConfirm() {
    onConfirm(values);
  }

  // 선택된 옵션 개수 — 헤더/버튼 라벨에 표시
  const selectedCount = Object.values(values).filter(Boolean).length;

  return (
    <div style={overlayStyle} onClick={onClose} role="dialog" aria-modal="true">
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div style={headerStyle}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>
              {artifact.icon} {artifact.title}
            </div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
              포함할 항목을 선택한 뒤 다운로드하세요.
            </div>
          </div>
          <button onClick={onClose} aria-label="닫기" style={closeBtnStyle}>×</button>
        </div>

        {/* 본문 — 옵션 체크박스 */}
        <div style={bodyStyle}>
          {/* 필수 항목 안내 — "요구사항 일람·현행본"은 항상 포함됨을 명시 */}
          <div style={mandatoryStyle}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-primary)" }}>
              필수 포함
            </div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 4 }}>
              요구사항 일람 · 현행본은 항상 포함됩니다.
            </div>
          </div>

          {/* 옵션 항목들 */}
          {opts.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
              선택할 옵션이 없습니다.
            </div>
          ) : (
            opts.map((opt) => (
              <label key={opt.key} style={optionRowStyle}>
                <input
                  type="checkbox"
                  checked={!!values[opt.key]}
                  onChange={() => toggle(opt.key)}
                  style={{ marginTop: 3, cursor: "pointer" }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
                    {opt.label}
                  </div>
                  {opt.description && (
                    <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
                      {opt.description}
                    </div>
                  )}
                </div>
              </label>
            ))
          )}
        </div>

        {/* 푸터 — 취소 / 다운로드 */}
        <div style={footerStyle}>
          <button onClick={onClose} style={ghostBtnStyle}>취소</button>
          <button onClick={handleConfirm} style={primaryBtnStyle}>
            Word ↓ 다운로드 {selectedCount > 0 ? `(+${selectedCount})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 스타일 ────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000,
};
const panelStyle: React.CSSProperties = {
  width: "min(480px, 92vw)",
  background: "var(--color-bg-card)",
  borderRadius: 8,
  boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
  display: "flex", flexDirection: "column",
  overflow: "hidden",
};
const headerStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 12,
  padding: "16px 20px",
  borderBottom: "1px solid var(--color-border)",
};
const closeBtnStyle: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  fontSize: 22, lineHeight: 1, color: "var(--color-text-secondary)",
  padding: "0 4px",
};
const bodyStyle: React.CSSProperties = {
  padding: "16px 20px",
  display: "flex", flexDirection: "column", gap: 12,
};
const mandatoryStyle: React.CSSProperties = {
  padding: "10px 12px",
  background: "var(--color-bg-muted)",
  borderRadius: 6,
};
const optionRowStyle: React.CSSProperties = {
  display: "flex", alignItems: "flex-start", gap: 10,
  padding: "10px 12px",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  cursor: "pointer",
  background: "var(--color-bg-card)",
};
const footerStyle: React.CSSProperties = {
  display: "flex", justifyContent: "flex-end", gap: 8,
  padding: "14px 20px",
  borderTop: "1px solid var(--color-border)",
};
const ghostBtnStyle: React.CSSProperties = {
  padding: "7px 16px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 13, fontWeight: 600,
  cursor: "pointer",
};
const primaryBtnStyle: React.CSSProperties = {
  padding: "7px 18px", borderRadius: 6, border: "1px solid transparent",
  background: "var(--color-primary, #1976d2)", color: "#fff",
  fontSize: 13, fontWeight: 600,
  cursor: "pointer",
};
