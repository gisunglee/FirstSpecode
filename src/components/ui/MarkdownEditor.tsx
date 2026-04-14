"use client";

/**
 * MarkdownEditor — 마크다운 편집/미리보기 전환 에디터
 *
 * 역할:
 *   - tab / onTabChange 를 외부에서 전달하면 외부 제어 (탭 버튼을 라벨 옆에 배치 가능)
 *   - 전달하지 않으면 내부 상태로 자체 제어
 *   - 내부 헤더 행 없음 — 세로 공간 낭비 방지
 */

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { renderMarkdown } from "@/lib/renderMarkdown";

/**
 * HTML 문서 여부 판별 — <!DOCTYPE, <html, <head, <body 등
 * 전체 HTML 문서는 dangerouslySetInnerHTML로 삽입하면
 * 전역 스타일이 본창을 오염시키므로 iframe으로 격리해야 함
 */
function isFullHtmlDocument(content: string): boolean {
  const trimmed = content.trimStart().substring(0, 200).toLowerCase();
  return trimmed.startsWith("<!doctype") || trimmed.startsWith("<html");
}

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
  tab: externalTab, onTabChange: _onTabChange,
  fullHeight = false,
}: Props) {
  // 외부 탭이 없으면 내부 state로 fallback (탭 버튼은 외부 MarkdownTabButtons에서 제어)
  const [internalTab] = useState<"edit" | "preview">("edit");
  const tab = externalTab ?? internalTab;

  // HTML 문서 여부를 메모이제이션 — 불필요한 재계산 방지
  const isHtml = useMemo(() => isFullHtmlDocument(value), [value]);

  // Mermaid 코드블록 포함 여부 — ```mermaid 패턴 감지
  const hasMermaid = useMemo(() => /```mermaid/i.test(value), [value]);

  // 마크다운 미리보기 영역 ref — Mermaid 렌더링용
  const mdPreviewRef = useRef<HTMLDivElement>(null);

  // Mermaid 코드블록을 다이어그램으로 변환
  const renderMermaidBlocks = useCallback(async () => {
    const container = mdPreviewRef.current;
    if (!container) return;

    // marked가 ```mermaid 블록을 <code class="language-mermaid"> 로 변환함
    const codeEls = container.querySelectorAll<HTMLElement>("code.language-mermaid");
    if (codeEls.length === 0) return;

    try {
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({ startOnLoad: false, theme: "default" });

      for (let i = 0; i < codeEls.length; i++) {
        const codeEl = codeEls[i];
        const preEl = codeEl.parentElement;   // <pre> 래퍼
        const src = codeEl.textContent ?? "";
        if (!src.trim()) continue;

        try {
          const { svg } = await mermaid.render(`mde-mm-${Date.now()}-${i}`, src);
          // <pre><code> → Mermaid SVG 래퍼로 교체
          const wrapper = document.createElement("div");
          wrapper.className = "mermaid-rendered";
          wrapper.style.cssText = "overflow-x:auto;padding:12px 0;text-align:center";
          wrapper.innerHTML = svg;
          (preEl ?? codeEl).replaceWith(wrapper);
        } catch (err) {
          // 개별 블록 에러 — 원본 유지, 에러 메시지 추가
          const errDiv = document.createElement("div");
          errDiv.style.cssText = "color:#e53935;font-size:12px;margin-top:4px";
          errDiv.textContent = `Mermaid 렌더링 오류: ${err}`;
          (preEl ?? codeEl).after(errDiv);
        }
      }
    } catch {
      // mermaid 모듈 로드 실패 — 무시 (코드블록 그대로 표시)
    }
  }, []);

  // 미리보기 탭 + Mermaid 포함 시 렌더링 실행
  useEffect(() => {
    if (tab === "preview" && !isHtml && hasMermaid) {
      renderMermaidBlocks();
    }
  }, [tab, isHtml, hasMermaid, value, renderMermaidBlocks]);

  return (
    <div style={{
      display:       "flex",
      flexDirection: "column",
      flex:          fullHeight ? 1 : "none",
      minHeight:     0,
      height:        fullHeight ? "100%" : undefined,
    }}>
      {tab === "edit" ? (
        <textarea
          value={value}
          placeholder={placeholder}
          rows={fullHeight ? undefined : rows}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width:        "100%",
            height:       fullHeight ? "100%" : undefined,
            padding:      "8px 12px",
            borderRadius: 6,
            border:       "1px solid var(--color-border)",
            background:   readOnly ? "var(--color-bg-muted)" : "var(--color-bg-card)",
            color:        "var(--color-text-primary)",
            boxSizing:    "border-box",
            outline:      "none",
            resize:       "none",
            fontFamily:   "var(--font-mono, monospace)",
            fontSize:     12,
            lineHeight:   1.5,
            flex:         fullHeight ? 1 : "none",
            minHeight:    0,
          }}
        />
      ) : isHtml ? (
        /* HTML 문서는 iframe으로 격리 렌더링 — 전역 스타일 오염 방지 */
        <iframe
          srcDoc={value}
          sandbox="allow-scripts"
          style={{
            width:        "100%",
            height:       fullHeight ? "100%" : (rows * 21),
            border:       "1px solid var(--color-border)",
            borderRadius: 6,
            background:   "#fff",
            flex:         fullHeight ? 1 : "none",
            minHeight:    fullHeight ? 0 : (rows * 21),
          }}
          title="HTML 미리보기"
        />
      ) : (
        <div
          ref={mdPreviewRef}
          className="sp-markdown"
          style={{
            width:        "100%",
            height:       fullHeight ? "100%" : undefined,
            padding:      "12px 16px",
            border:       "1px solid var(--color-border)",
            background:   "var(--color-bg-card)",
            color:        "var(--color-text-primary)",
            boxSizing:    "border-box",
            minHeight:    fullHeight ? 0 : (rows * 21),
            maxHeight:    fullHeight ? "none" : (rows * 21),
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
  const btn = (t: "edit" | "preview", label: string) => (
    <button
      key={t}
      type="button"
      onClick={() => onTabChange(t)}
      style={{
        padding:      "4px 14px",
        borderRadius: 5,
        border:       "none",
        background:   tab === t ? "var(--color-primary, #1976d2)" : "transparent",
        color:        tab === t ? "#fff" : "var(--color-text-secondary)",
        fontSize:     12,
        fontWeight:   600,
        cursor:       "pointer",
      }}
    >
      {label}
    </button>
  );
  return (
    <div style={{ display: "flex", gap: 2, background: "var(--color-bg-muted)", borderRadius: 7, padding: 3 }}>
      {btn("edit",    "원문")}
      {btn("preview", "마크다운")}
    </div>
  );
}
