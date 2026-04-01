"use client";

/**
 * PrdDownloadDialog — PRD 마크다운 다운로드 팝업
 *
 * 역할:
 *   - 레벨(단위업무/화면/영역/기능) 선택 후 계층형 마크다운(.md) 다운로드
 *   - availableLevels prop으로 노출할 레벨 제한 (페이지별 다름)
 *   - 기능 페이지: UNIT_WORK | SCREEN | AREA | FUNCTION
 *   - 영역 페이지: UNIT_WORK | SCREEN | AREA
 *   - 화면 페이지: UNIT_WORK | SCREEN
 */

import { useState } from "react";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ──────────────────────────────────────────────────────────────────────

export type PrdLevel = "UNIT_WORK" | "SCREEN" | "AREA" | "FUNCTION";

const LEVEL_LABELS: Record<PrdLevel, string> = {
  UNIT_WORK: "단위업무",
  SCREEN:    "화면",
  AREA:      "영역",
  FUNCTION:  "기능",
};

// 각 레벨 선택 시 생성 범위 설명
const LEVEL_DESC: Record<PrdLevel, string> = {
  UNIT_WORK: "단위업무 + 하위 화면 · 영역 · 기능 전체",
  SCREEN:    "화면 + 하위 영역 · 기능 전체",
  AREA:      "영역 + 하위 기능 전체",
  FUNCTION:  "기능 설명만",
};

export interface PrdDownloadDialogProps {
  open:            boolean;
  onClose:         () => void;
  projectId:       string;
  // 노출할 레벨 목록 (위에서 아래 순서로 표시)
  availableLevels: PrdLevel[];
  // 초기 선택 레벨
  defaultLevel:    PrdLevel;
  // 각 레벨별 참조 ID (null이면 해당 레벨 비활성화)
  unitWorkId?: string | null;
  screenId?:   string | null;
  areaId?:     string | null;
  functionId?: string | null;
}

// ── 컴포넌트 ─────────────────────────────────────────────────────────────────

export default function PrdDownloadDialog({
  open, onClose, projectId,
  availableLevels, defaultLevel,
  unitWorkId, screenId, areaId, functionId,
}: PrdDownloadDialogProps) {
  const [selectedLevel, setSelectedLevel] = useState<PrdLevel>(defaultLevel);
  const [loading, setLoading] = useState(false);

  // 레벨 → 참조 ID 매핑
  const refIdMap: Record<PrdLevel, string | null | undefined> = {
    UNIT_WORK: unitWorkId,
    SCREEN:    screenId,
    AREA:      areaId,
    FUNCTION:  functionId,
  };

  async function handleDownload() {
    const refId = refIdMap[selectedLevel];
    if (!refId) {
      toast.error("선택한 레벨의 데이터가 없습니다.");
      return;
    }

    setLoading(true);
    try {
      const res = await authFetch<{ data: { markdown: string; filename: string } }>(
        `/api/projects/${projectId}/prd?level=${selectedLevel}&refId=${refId}`
      );
      const { markdown, filename } = res.data;

      // 브라우저 다운로드 트리거
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "다운로드에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>

        {/* 헤더 */}
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>PRD 다운로드</h3>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--color-text-secondary)" }}>
            출력 범위를 선택하면 계층형 마크다운 파일로 저장됩니다.
          </p>
        </div>

        {/* 레벨 선택 라디오 버튼 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
          {availableLevels.map((level) => {
            const refId    = refIdMap[level];
            const disabled = !refId;
            const checked  = selectedLevel === level;
            return (
              <label
                key={level}
                style={{
                  display:       "flex",
                  alignItems:    "flex-start",
                  gap:           10,
                  padding:       "10px 14px",
                  borderRadius:  7,
                  border:        `1px solid ${checked ? "var(--color-primary, #1976d2)" : "var(--color-border)"}`,
                  background:    checked ? "rgba(25,118,210,0.05)" : "var(--color-bg-card)",
                  cursor:        disabled ? "not-allowed" : "pointer",
                  opacity:       disabled ? 0.4 : 1,
                  transition:    "border-color 0.15s, background 0.15s",
                }}
              >
                <input
                  type="radio"
                  name="prd-level"
                  value={level}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => !disabled && setSelectedLevel(level)}
                  style={{ marginTop: 2, accentColor: "var(--color-primary, #1976d2)" }}
                />
                <div>
                  <div style={{ fontSize: 14, fontWeight: checked ? 600 : 400, color: "var(--color-text-primary)" }}>
                    {LEVEL_LABELS[level]}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
                    {LEVEL_DESC[level]}
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        {/* 하단 버튼 */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} disabled={loading} style={secondaryBtnStyle}>
            취소
          </button>
          <button onClick={handleDownload} disabled={loading} style={primaryBtnStyle}>
            {loading ? "생성 중..." : "다운로드"}
          </button>
        </div>

      </div>
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position:       "fixed",
  inset:          0,
  background:     "rgba(0,0,0,0.45)",
  display:        "flex",
  alignItems:     "center",
  justifyContent: "center",
  zIndex:         2000,
};

const dialogStyle: React.CSSProperties = {
  background:   "var(--color-bg-card)",
  borderRadius: 10,
  padding:      "28px 32px",
  width:        380,
  boxShadow:    "0 8px 32px rgba(0,0,0,0.2)",
};

const primaryBtnStyle: React.CSSProperties = {
  padding:      "8px 20px",
  borderRadius: 6,
  border:       "none",
  background:   "var(--color-primary, #1976d2)",
  color:        "#fff",
  fontSize:     13,
  fontWeight:   600,
  cursor:       "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding:      "8px 16px",
  borderRadius: 6,
  border:       "1px solid var(--color-border)",
  background:   "transparent",
  color:        "var(--color-text-primary)",
  fontSize:     13,
  cursor:       "pointer",
};
