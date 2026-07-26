"use client";

/**
 * ReqSaveOptionDialog — 요구사항 저장 시 "변경 이력 저장 여부" 선택 다이얼로그
 *
 * 요구사항 개별 편집(PID-00031)과 일괄 편집(PID-00039 기획 트리) 양쪽에서 공유.
 * 두 화면 모두 원문/현행화·분석메모·상세명세를 고치면 동일한 다이얼로그로
 * 이력 저장 여부를 물어야 한다 — 화면마다 이력이 남는지 여부가 달라지면 안 됨.
 */

import { useState } from "react";

export type ReqSaveOptionResult = {
  saveHistory?: boolean;
  versionMode?: string;
  versionComment?: string;
  saveSpecHistory?: boolean;
  saveAnalyHistory?: boolean;
};

export type ReqChangedFlags = {
  contentChanged: boolean;
  specChanged: boolean;
  analyChanged: boolean;
};

export function ReqSaveOptionDialog({ lastVersion, changedFlags, onClose, onSave, isPending }: {
  lastVersion: string | null;
  changedFlags: ReqChangedFlags;
  onClose: () => void;
  onSave: (opts: ReqSaveOptionResult) => void;
  isPending: boolean;
}) {
  // 요구사항 내용 이력 모드
  type VersionMode = "none" | "minor" | "major";
  const [versionMode, setVersionMode] = useState<VersionMode>("none");
  const [comment, setComment] = useState("");

  // 상세명세·분석메모 이력 저장 여부
  const [saveSpec, setSaveSpec] = useState(false);
  const [saveAnaly, setSaveAnaly] = useState(false);

  // 버전 미리보기
  const parts = (lastVersion ?? "V1.0").replace("V", "").split(".");
  const major = parseInt(parts[0] ?? "1", 10);
  const minor = parseInt(parts[1] ?? "0", 10);

  function handleSave() {
    onSave({
      // 요구사항 내용 이력
      ...(changedFlags.contentChanged && versionMode !== "none"
        ? { saveHistory: true, versionMode, versionComment: comment }
        : {}),
      // 상세명세 이력
      saveSpecHistory: changedFlags.specChanged && saveSpec,
      // 분석메모 이력
      saveAnalyHistory: changedFlags.analyChanged && saveAnaly,
    });
  }

  const checkboxStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
    borderRadius: 6, fontSize: 13, cursor: "pointer",
    border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  };

  const radioStyle = (active: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
    borderRadius: 6, cursor: "pointer", fontSize: 13,
    border: active ? "1px solid var(--color-primary, #1976d2)" : "1px solid var(--color-border)",
    background: active ? "var(--color-brand-subtle, rgba(25,118,210,0.06))" : "var(--color-bg-card)",
  });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--color-bg-card)", borderRadius: 10, padding: "24px 28px", minWidth: 400, maxWidth: 500, width: "100%", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
        <h3 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700 }}>변경 이력 저장</h3>
        <p style={{ margin: "0 0 18px", fontSize: 13, color: "var(--color-text-secondary)" }}>
          변경된 항목의 이력 저장 여부를 선택하세요.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* ── 요구사항 내용 (원문/현행화) ── */}
          {changedFlags.contentChanged && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#1976d2", display: "inline-block" }} />
                요구사항 내용 변경됨
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 12 }}>
                <label style={radioStyle(versionMode === "none")} onClick={() => setVersionMode("none")}>
                  <input type="radio" name="vMode" checked={versionMode === "none"} onChange={() => setVersionMode("none")} />
                  이력 없이 저장
                </label>
                <label style={radioStyle(versionMode === "minor")} onClick={() => setVersionMode("minor")}>
                  <input type="radio" name="vMode" checked={versionMode === "minor"} onChange={() => setVersionMode("minor")} />
                  마이너 버전 <span style={{ color: "#1976d2", fontSize: 12, fontWeight: 600 }}>V{major}.{minor + 1}</span>
                </label>
                <label style={radioStyle(versionMode === "major")} onClick={() => setVersionMode("major")}>
                  <input type="radio" name="vMode" checked={versionMode === "major"} onChange={() => setVersionMode("major")} />
                  메이저 버전 <span style={{ color: "#e65100", fontSize: 12, fontWeight: 600 }}>V{major + 1}.0</span>
                </label>
                {versionMode !== "none" && (
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="사유 (선택)"
                    rows={2}
                    style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg-card)", color: "var(--color-text-primary)", fontSize: 12, resize: "vertical", boxSizing: "border-box", marginTop: 4 }}
                  />
                )}
              </div>
            </div>
          )}

          {/* ── 상세 명세 ── */}
          {changedFlags.specChanged && (
            <label style={checkboxStyle}>
              <input type="checkbox" checked={saveSpec} onChange={(e) => setSaveSpec(e.target.checked)} />
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#2e7d32", display: "inline-block" }} />
              <span style={{ flex: 1 }}>상세 명세 변경이력 저장</span>
            </label>
          )}

          {/* ── 분석 메모 ── */}
          {changedFlags.analyChanged && (
            <label style={checkboxStyle}>
              <input type="checkbox" checked={saveAnaly} onChange={(e) => setSaveAnaly(e.target.checked)} />
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#6a1b9a", display: "inline-block" }} />
              <span style={{ flex: 1 }}>분석 메모 변경이력 저장</span>
            </label>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <button onClick={onClose} disabled={isPending} style={{ ...secondaryBtnStyle, fontSize: 13 }}>취소</button>
          <button onClick={handleSave} disabled={isPending} style={{ ...secondaryBtnStyle, fontSize: 13, background: "var(--color-primary, #1976d2)", color: "#fff", border: "none" }}>
            {isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

const secondaryBtnStyle: React.CSSProperties = {
  padding:      "7px 16px",
  borderRadius: 6,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     13,
  cursor:       "pointer",
};
