"use client";

/**
 * MarkdownEditor — 마크다운 편집/미리보기 전환 에디터
 *
 * 역할:
 *   - tab / onTabChange 를 외부에서 전달하면 외부 제어 (탭 버튼을 라벨 옆에 배치 가능)
 *   - 전달하지 않으면 내부 상태로 자체 제어
 *   - 내부 헤더 행 없음 — 세로 공간 낭비 방지
 */

import React, { useState } from "react";
import { renderMarkdown } from "@/lib/renderMarkdown";

type Props = {
  value:          string;
  onChange:       (v: string) => void;
  placeholder?:   string;
  rows?:          number;
  readOnly?:      boolean;
  /** 외부에서 탭 제어 시 전달. 없으면 내부 state 사용 */
  tab?:           "edit" | "preview";
  onTabChange?:   (tab: "edit" | "preview") => void;
  fullHeight?:    boolean;
};

export default function MarkdownEditor({
  value, onChange, placeholder, rows = 14, readOnly = false,
  tab: externalTab, onTabChange,
  fullHeight = false,
}: Props) {
  // 외부 탭이 없으면 내부 state로 fallback
  const [internalTab, setInternalTab] = useState<"edit" | "preview">("edit");
  const tab        = externalTab ?? internalTab;
  const handleTab  = onTabChange ?? setInternalTab;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: fullHeight ? "100%" : "auto", flex: fullHeight ? 1 : "none" }}>
      {tab === "edit" ? (
        <textarea
          value={value}
          placeholder={placeholder}
          rows={rows}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width:       "100%",
            padding:     "8px 12px",
            borderRadius: 6,
            border:      "1px solid var(--color-border)",
            background:  readOnly ? "var(--color-bg-muted)" : "var(--color-bg-card)",
            color:       "var(--color-text-primary)",
            boxSizing:   "border-box",
            outline:     "none",
            resize:      "none",
            fontFamily:  "var(--font-mono, monospace)",
            fontSize:    12,
            lineHeight:  1.5,
            flex:        fullHeight ? 1 : "none",
            height:      fullHeight ? "100%" : "auto",
          }}
        />
      ) : (
        <div
          className="sp-markdown"
          style={{
            width:        "100%",
            padding:      "12px 16px",
            border:       "1px solid var(--color-border)",
            background:   "var(--color-bg-card)",
            color:        "var(--color-text-primary)",
            boxSizing:    "border-box",
            minHeight:    fullHeight ? "100%" : (rows * 21),
            borderRadius: 6,
            overflowY:    "auto",
            flex:         fullHeight ? 1 : "none",
          }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(value) || "<p style='color:#aaa;font-size:13px'>내용 없음</p>" }}
        />
      )}
    </div>
  );
}

/**
 * MarkdownTabButtons — "마크다운 | 미리보기" 탭 버튼
 *
 * 라벨 옆에 인라인으로 배치하는 용도.
 *
 * 사용 예시:
 *   <div style={{ display:"flex", justifyContent:"space-between" }}>
 *     <label>설명</label>
 *     <MarkdownTabButtons tab={tab} onTabChange={setTab} />
 *   </div>
 *   <MarkdownEditor value={...} onChange={...} tab={tab} onTabChange={setTab} />
 */
export function MarkdownTabButtons({
  tab, onTabChange,
}: {
  tab:          "edit" | "preview";
  onTabChange:  (tab: "edit" | "preview") => void;
}) {
  return (
    <div style={{ display: "flex", gap: 2, background: "var(--color-bg-muted)", borderRadius: 6, padding: 2 }}>
      {(["edit", "preview"] as const).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onTabChange(t)}
          style={{
            padding:      "2px 10px",
            borderRadius: 4,
            border:       "none",
            background:   tab === t ? "var(--color-bg-card)" : "transparent",
            color:        tab === t ? "var(--color-text-primary)" : "var(--color-text-secondary)",
            fontSize:     11,
            fontWeight:   tab === t ? 700 : 400,
            cursor:       "pointer",
            boxShadow:    tab === t ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            transition:   "all 0.15s",
          }}
        >
          {t === "edit" ? "마크다운" : "미리보기"}
        </button>
      ))}
    </div>
  );
}
