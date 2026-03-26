"use client";

/**
 * ScreenLayoutEditor — 화면 레이아웃 편집 컴포넌트
 *
 * 역할:
 *   - 행(Row) / 열(Column) 단위 레이아웃 구성
 *   - 열 너비(widthRatio, %) + 라벨(영역 선택 또는 직접 입력) 편집
 *   - 레이아웃을 Markdown / JSON 팝업으로 출력 (AI 친화적)
 *   - 변경 결과는 부모 onChange 콜백으로 전달 (JSON 직렬화는 부모 담당)
 *
 * 데이터 구조 (layer_data_dc 컬럼에 JSON 문자열로 저장):
 *   LayoutRow[] = [
 *     { id: "uuid", columns: [{ id: "uuid", widthRatio: 100, label: "검색조건" }] },
 *     ...
 *   ]
 *
 * 디자인: sp- 디자인 시스템 (--color-*, --space-* 토큰, no Tailwind)
 */

import { useState } from "react";

/* ── 타입 ──────────────────────────────────────────────────────────────────── */

export interface LayoutColumn {
  id: string;
  /** 너비 비율 (1~100, %) */
  widthRatio: number;
  /** 매핑된 영역 ID (UUID) */
  areaId?: string;
  /** 직접 입력 라벨 */
  label?: string;
}

export interface LayoutRow {
  id: string;
  columns: LayoutColumn[];
}

interface AreaOption {
  areaId:    string;
  displayId: string;
  name:      string;
}

interface ScreenLayoutEditorProps {
  value:    LayoutRow[];
  onChange: (rows: LayoutRow[]) => void;
  /** 하위 영역 목록 — 제공되면 드롭다운으로 영역 선택, 없으면 직접 입력 */
  areas?:   AreaOption[];
  /** 직접 입력 시 placeholder 텍스트 (기본: "영역 라벨") */
  columnLabelPlaceholder?: string;
}

/* ── 유틸 ──────────────────────────────────────────────────────────────────── */

const uid = () => crypto.randomUUID();

const emptyColumn = (): LayoutColumn => ({ id: uid(), widthRatio: 100 });
const emptyRow    = (): LayoutRow    => ({ id: uid(), columns: [emptyColumn()] });

const parseWidth = (text: string): number | null => {
  const num = parseInt(text);
  if (isNaN(num) || num < 1 || num > 100) return null;
  return num;
};

/* ── 메인 컴포넌트 ──────────────────────────────────────────────────────────── */

export function ScreenLayoutEditor({ value, onChange, areas = [], columnLabelPlaceholder = "영역 라벨" }: ScreenLayoutEditorProps) {
  const [popupOpen, setPopupOpen] = useState(false);
  const [viewMode,  setViewMode]  = useState<"markdown" | "json">("markdown");
  const [copied,    setCopied]    = useState(false);

  /* ── 출력 포맷 ─────────────────────────────────────────────────────────── */

  const formatAsMarkdown = (): string => {
    if (value.length === 0) return "레이아웃이 없습니다.";
    const lines: string[] = [];
    value.forEach((row, i) => {
      lines.push(`### 행 ${i + 1}`);
      lines.push("| 영역ID | 설명 | 너비 |");
      lines.push("|--------|------|------|");
      row.columns.forEach((col) => {
        const area = col.areaId ? areas.find((a) => a.areaId === col.areaId) : null;
        const areaId      = area ? area.displayId : "-";
        const description = area ? area.name : (col.label || "-");
        lines.push(`| ${areaId} | ${description} | ${col.widthRatio}% |`);
      });
      lines.push("");
    });
    return lines.join("\n");
  };

  const formatAsJson = (): string => {
    return JSON.stringify(
      value.map((row, i) => ({
        row:     i + 1,
        columns: row.columns.map((col) => {
          const area = col.areaId ? areas.find((a) => a.areaId === col.areaId) : null;
          return {
            width: `${col.widthRatio}%`,
            ...(area
              ? { areaId: area.displayId, description: area.name }
              : col.label
                ? { description: col.label }
                : {}),
          };
        }),
      })),
      null,
      2
    );
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(
      viewMode === "json" ? formatAsJson() : formatAsMarkdown()
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  /* ── 행·열 조작 ────────────────────────────────────────────────────────── */

  const addRow = () => onChange([...value, emptyRow()]);

  const removeRow = (rowId: string) =>
    onChange(value.filter((r) => r.id !== rowId));

  const addColumn = (rowId: string) =>
    onChange(
      value.map((r) =>
        r.id === rowId ? { ...r, columns: [...r.columns, emptyColumn()] } : r
      )
    );

  const removeColumn = (rowId: string, colId: string) =>
    onChange(
      value.map((r) =>
        r.id === rowId
          ? { ...r, columns: r.columns.filter((c) => c.id !== colId) }
          : r
      )
    );

  const updateColumn = (rowId: string, colId: string, patch: Partial<LayoutColumn>) =>
    onChange(
      value.map((r) =>
        r.id === rowId
          ? { ...r, columns: r.columns.map((c) => (c.id === colId ? { ...c, ...patch } : c)) }
          : r
      )
    );

  /* ── 렌더링 ────────────────────────────────────────────────────────────── */

  return (
    <div>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
          레이아웃 구성
        </span>
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => { setPopupOpen(true); setCopied(false); }}
            style={{
              background:   "none",
              border:       "1px solid var(--color-border)",
              borderRadius: 5,
              padding:      "3px 10px",
              fontSize:     12,
              cursor:       "pointer",
              color:        "var(--color-text-secondary)",
            }}
            title="레이아웃 출력 (Markdown / JSON)"
          >
            출력
          </button>
        )}
      </div>

      {/* 행 목록 */}
      {value.length === 0 ? (
        <div
          style={{
            border:       "1px dashed var(--color-border)",
            borderRadius: 6,
            padding:      "20px 0",
            textAlign:    "center",
            fontSize:     13,
            color:        "var(--color-text-tertiary)",
            marginBottom: 10,
          }}
        >
          행이 없습니다. 아래 버튼으로 행을 추가하세요.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
          {value.map((row, rowIdx) => (
            <div
              key={row.id}
              style={{
                border:       "1px solid var(--color-border)",
                borderRadius: 6,
                padding:      "10px 12px",
                background:   "var(--color-bg-elevated)",
              }}
            >
              {/* 행 헤더 */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)" }}>
                  행 {rowIdx + 1}
                </span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    type="button"
                    onClick={() => addColumn(row.id)}
                    style={iconBtnStyle}
                    title="열 추가"
                  >
                    열+
                  </button>
                  <button
                    type="button"
                    onClick={() => removeRow(row.id)}
                    style={{ ...iconBtnStyle, color: "var(--color-error, #e53935)" }}
                    title="행 삭제"
                  >
                    ×
                  </button>
                </div>
              </div>

              {/* 열 목록 */}
              <div style={{ display: "flex", gap: 8 }}>
                {row.columns.map((col) => (
                  <div
                    key={col.id}
                    style={{
                      flex:         `${col.widthRatio} 0 0`,
                      minWidth:     0,
                      border:       "1px solid var(--color-border)",
                      borderRadius: 5,
                      padding:      "8px 10px",
                      background:   "var(--color-bg-card)",
                      display:      "flex",
                      flexDirection: "column",
                      gap:          6,
                    }}
                  >
                    {/* 너비 입력 */}
                    <input
                      key={`w-${col.id}-${col.widthRatio}`}
                      list="sp-layout-width-presets"
                      defaultValue={`${col.widthRatio}%`}
                      onFocus={(e) => { e.target.value = ""; }}
                      onBlur={(e) => {
                        if (!e.target.value.trim()) {
                          e.target.value = `${col.widthRatio}%`;
                          return;
                        }
                        const w = parseWidth(e.target.value);
                        if (w) updateColumn(row.id, col.id, { widthRatio: w });
                        else    e.target.value = `${col.widthRatio}%`;
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      placeholder={`${col.widthRatio}%`}
                      style={{
                        ...colInputStyle,
                        fontWeight: 600,
                        color: "var(--color-text-secondary)",
                      }}
                    />

                    {/* 영역 선택 or 라벨 입력 */}
                    {areas.length > 0 ? (
                      <select
                        value={col.areaId ?? ""}
                        onChange={(e) =>
                          updateColumn(row.id, col.id, {
                            areaId: e.target.value || undefined,
                            label:  undefined,
                          })
                        }
                        style={colInputStyle}
                      >
                        <option value="">미지정</option>
                        {areas.map((a) => (
                          <option key={a.areaId} value={a.areaId}>
                            {a.displayId} {a.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        key={`l-${col.id}`}
                        defaultValue={col.label ?? ""}
                        onBlur={(e) =>
                          updateColumn(row.id, col.id, { label: e.target.value || undefined })
                        }
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                        placeholder={columnLabelPlaceholder}
                        style={colInputStyle}
                      />
                    )}

                    {/* 열 삭제 (2열 이상일 때만) */}
                    {row.columns.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeColumn(row.id, col.id)}
                        style={{
                          background:  "none",
                          border:      "none",
                          cursor:      "pointer",
                          fontSize:    11,
                          color:       "var(--color-text-tertiary)",
                          padding:     "0 2px",
                          textAlign:   "right",
                        }}
                      >
                        열 삭제
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 행 추가 버튼 */}
      <button
        type="button"
        onClick={addRow}
        style={{
          width:        "100%",
          padding:      "7px 0",
          border:       "1px dashed var(--color-border)",
          borderRadius: 6,
          background:   "none",
          fontSize:     13,
          cursor:       "pointer",
          color:        "var(--color-text-secondary)",
        }}
      >
        + 행 추가
      </button>

      {/* 너비 프리셋 datalist */}
      <datalist id="sp-layout-width-presets">
        <option value="100%" />
        <option value="75%" />
        <option value="66%" />
        <option value="50%" />
        <option value="33%" />
        <option value="25%" />
      </datalist>

      {/* ── 출력 팝업 ──────────────────────────────────────────────────────── */}
      {popupOpen && (
        <div
          style={{
            position:        "fixed",
            inset:           0,
            zIndex:          300,
            background:      "rgba(0,0,0,0.45)",
            display:         "flex",
            alignItems:      "center",
            justifyContent:  "center",
          }}
          onClick={() => setPopupOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width:        "100%",
              maxWidth:     520,
              background:   "var(--color-bg-card)",
              border:       "1px solid var(--color-border-strong, var(--color-border))",
              borderRadius: 10,
              boxShadow:    "0 8px 32px rgba(0,0,0,0.2)",
              padding:      "20px 24px",
            }}
          >
            {/* 팝업 헤더 */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>
                레이아웃 텍스트
              </span>
              <button
                type="button"
                onClick={() => setPopupOpen(false)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#888" }}
              >
                ×
              </button>
            </div>

            {/* 형식 전환 + 복사 */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ display: "flex", gap: 6 }}>
                {(["markdown", "json"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => { setViewMode(mode); setCopied(false); }}
                    style={{
                      padding:      "4px 10px",
                      borderRadius: 5,
                      cursor:       "pointer",
                      fontSize:     12,
                      color:        "var(--color-text-primary)",
                      background:   viewMode === mode ? "var(--color-bg-elevated)" : "none",
                      fontWeight:   viewMode === mode ? 700 : 400,
                      border:       `1px solid ${viewMode === mode ? "var(--color-border)" : "transparent"}`,
                    }}
                  >
                    {mode === "markdown" ? "마크다운" : "JSON"}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={handleCopy}
                style={{
                  padding:      "4px 12px",
                  border:       "1px solid var(--color-border)",
                  borderRadius: 5,
                  background:   "none",
                  fontSize:     12,
                  cursor:       "pointer",
                  color:        copied ? "#2e7d32" : "var(--color-text-primary)",
                }}
              >
                {copied ? "복사됨 ✓" : "복사"}
              </button>
            </div>

            {/* 텍스트 내용 */}
            <pre
              style={{
                background:    "var(--color-bg-elevated)",
                border:        "1px solid var(--color-border)",
                borderRadius:  6,
                padding:       "14px 16px",
                fontSize:      12,
                lineHeight:    1.6,
                whiteSpace:    "pre-wrap",
                overflowY:     "auto",
                maxHeight:     320,
                color:         "var(--color-text-primary)",
                margin:        0,
              }}
            >
              {viewMode === "json" ? formatAsJson() : formatAsMarkdown()}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 스타일 상수 ──────────────────────────────────────────────────────────── */

const colInputStyle: React.CSSProperties = {
  width:        "100%",
  padding:      "4px 8px",
  borderRadius: 4,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     12,
  boxSizing:    "border-box",
  outline:      "none",
};

const iconBtnStyle: React.CSSProperties = {
  background:   "none",
  border:       "1px solid var(--color-border)",
  borderRadius: 4,
  padding:      "2px 7px",
  fontSize:     12,
  cursor:       "pointer",
  color:        "var(--color-text-secondary)",
};
