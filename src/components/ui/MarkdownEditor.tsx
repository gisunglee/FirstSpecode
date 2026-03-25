"use client";

import React, { useState } from "react";
import { renderMarkdown } from "@/lib/renderMarkdown";

export default function MarkdownEditor({
  value, onChange, placeholder, rows = 14,
}: {
  value:        string;
  onChange:     (v: string) => void;
  placeholder?: string;
  rows?:        number;
}) {
  const [tab, setTab] = useState<"edit" | "preview">("edit");

  return (
    <div>
      {/* 탭 */}
      <div style={{ display: "flex", gap: 16, borderBottom: "1px solid var(--color-border)", marginBottom: 12 }}>
        {(["edit", "preview"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              padding:      "6px 4px",
              border:       "none",
              borderBottom: tab === t ? "2px solid var(--color-primary, #1976d2)" : "2px solid transparent",
              background:   "transparent",
              color:        tab === t ? "var(--color-primary, #1976d2)" : "var(--color-text-secondary)",
              fontSize:     13,
              fontWeight:   tab === t ? 600 : 500,
              cursor:       "pointer",
              transition:   "all 0.2s ease",
              marginBottom: -1,
            }}
          >
            {t === "edit" ? "편집" : "미리보기"}
          </button>
        ))}
      </div>

      {tab === "edit" ? (
        <textarea
          value={value}
          placeholder={placeholder}
          rows={rows}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: "100%",
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid var(--color-border)",
            background: "var(--color-bg-card)",
            color: "var(--color-text-primary)",
            boxSizing: "border-box",
            outline: "none",
            resize:      "vertical",
            fontFamily:  "monospace",
            fontSize:    13,
          }}
        />
      ) : (
        <div
          className="sp-markdown"
          style={{
            width: "100%",
            padding: "16px",
            border: "1px solid var(--color-border)",
            background: "var(--color-bg-card)",
            color: "var(--color-text-primary)",
            boxSizing: "border-box",
            minHeight:    rows * 20,
            maxHeight:    600,
            borderRadius: 6,
            overflowY:    "auto",
          }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(value) || "<p style='color:#aaa;font-size:13px'>내용 없음</p>" }}
        />
      )}
    </div>
  );
}
