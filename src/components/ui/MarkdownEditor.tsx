"use client";

import React, { useState } from "react";
import { renderMarkdown } from "@/lib/renderMarkdown";

export default function MarkdownEditor({
  value, onChange, placeholder, rows = 14, readOnly = false, initialTab = "preview", title,
}: {
  value:        string;
  onChange:     (v: string) => void;
  placeholder?: string;
  rows?:        number;
  readOnly?:    boolean;
  initialTab?:  "edit" | "preview";
  title?:       string;
}) {
  const [tab, setTab] = useState<"edit" | "preview">(initialTab);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* 헤더: 제목 + 토글 버튼 */}
      <div style={{ 
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "center", 
        paddingBottom: 4,
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 6,
        flexShrink: 0
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", opacity: 0.8 }}>
          {title}
        </div>
        <button
          type="button"
          onClick={() => setTab(tab === "edit" ? "preview" : "edit")}
          style={{
            padding:      "2px 10px",
            border:       "1px solid var(--color-border)",
            borderRadius: 12,
            background:   tab === "edit" ? "var(--color-brand-subtle, #e8f0fe)" : "var(--color-bg-card)",
            color:        tab === "edit" ? "var(--color-brand, #1976d2)" : "var(--color-text-secondary)",
            fontSize:     10,
            fontWeight:   700,
            cursor:       "pointer",
            transition:   "all 0.2s ease",
            boxShadow:    "0 1px 2px rgba(0,0,0,0.05)"
          }}
        >
          {tab === "edit" ? "PREVIEW" : "EDIT CODE"}
        </button>
      </div>

      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {tab === "edit" ? (
          <textarea
            value={value}
            placeholder={placeholder}
            rows={rows}
            readOnly={readOnly}
            onChange={(e) => onChange(e.target.value)}
            style={{
              flex: 1,
              width: "100%",
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid var(--color-border)",
              background: readOnly ? "var(--color-bg-muted)" : "var(--color-bg-card)",
              color: "var(--color-text-primary)",
              boxSizing: "border-box",
              outline: "none",
              resize:      "none",
              fontFamily:  "var(--font-mono, monospace)",
              fontSize:    12,
              lineHeight:  1.5,
            }}
          />
        ) : (
          <div
            className="sp-markdown"
            style={{
              flex: 1,
              width: "100%",
              padding: "12px 16px",
              border: "1px solid var(--color-border)",
              background: "var(--color-bg-card)",
              color: "var(--color-text-primary)",
              boxSizing: "border-box",
              minHeight:    100,
              borderRadius: 6,
              overflowY:    "auto",
            }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(value) || "<p style='color:#aaa;font-size:13px'>내용 없음</p>" }}
          />
        )}
      </div>
    </div>
  );
}
