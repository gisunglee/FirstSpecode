"use client";

/**
 * MarkdownEditor — 마크다운 편집/미리보기 전환 에디터
 *
 * 역할:
 *   - tab / onTabChange 를 외부에서 전달하면 외부 제어 (탭 버튼을 라벨 옆에 배치 가능)
 *   - 전달하지 않으면 내부 상태로 자체 제어
 *   - 평소엔 내부 헤더 행 없음(세로 공간 낭비 방지) — 우상단 "⤢" 아이콘만 떠 있고,
 *     클릭해 확대했을 때만 헤더(드래그·탭·폰트조절·닫기)가 나타남
 */

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { renderMarkdown } from "@/lib/renderMarkdown";
import {
  TEXT_LIMITS, countChars,
  type TextLimitField,
} from "@/lib/constants/textLimits";
import { useEditorPrefsStore } from "@/store/editorPrefsStore";
import { useDraggablePosition } from "@/hooks/useDraggablePosition";
import { useResizablePanelSize } from "@/hooks/useResizablePanelSize";
import { FontScaleControl } from "./FontScaleControl";
import { PanelResizeHandle } from "./PanelResizeHandle";

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
  /**
   * 길이 제한 정책 키 — src/lib/constants/textLimits.ts 의 키.
   * 지정 시: 우하단 카운터 표시 + 한도 도달 시 입력 차단(maxLength).
   * 미지정 시: 무제한 (예: AI 결과 표시용).
   */
  field?:         TextLimitField;
  /** 확대 창 헤더에 표시할 이름(예: "상세 명세"). 미지정 시 "편집". */
  title?:         string;
};

export default function MarkdownEditor({
  value, onChange, placeholder, rows = 14, readOnly = false,
  tab: externalTab, onTabChange,
  fullHeight = false,
  field,
  title = "편집",
}: Props) {
  // 외부 탭이 없으면 내부 state로 fallback (탭 버튼은 외부 MarkdownTabButtons에서 제어)
  const [internalTab] = useState<"edit" | "preview">("edit");
  const tab = externalTab ?? internalTab;

  // RichEditor(요구사항내용)와 공유하는 전역 폰트 스케일 — FontScaleControl로 조절
  const fontScale = useEditorPrefsStore((s) => s.fontScale);

  // ── 확대 창(플로팅 패널) — RichEditor와 동일 패턴(모달 아님, 배경 계속 편집 가능) ──
  const [expanded, setExpanded] = useState(false);
  const { pos: panelPos, onDragStart: onPanelDragStart } = useDraggablePosition({ x: 32, y: 88 });
  // RichEditor(요구사항내용) 확대 창과 같은 기본 크기 — 폭이 서로 다르면 어색해서 통일
  const { size: panelSize, onResizeStart: onPanelResizeStart } = useResizablePanelSize({ width: 760, height: 600 });
  // 확대 중엔 rows/fullHeight 설정과 무관하게 패널 안을 꽉 채운다
  const stretch = fullHeight || expanded;

  // ── 길이 제한 (field prop 지정 시) ───────────────────────────────────────
  // current 는 글자수 기준 (이모지·서로게이트 안전).
  // textarea maxLength 는 UTF-16 코드 유닛 단위라 이모지 포함 시 약간 작게 차단되지만
  // API 검증이 정확한 글자수로 한 번 더 잡으므로 UI 는 근사로 충분.
  const max     = field ? TEXT_LIMITS[field] : undefined;
  const current = useMemo(() => (field ? countChars(value) : 0), [field, value]);
  const ratio   = max ? current / max : 0;
  const counterColor =
    ratio >= 1   ? "var(--color-error, #e53935)" :
    ratio >= 0.8 ? "#e57c00" :
                   "var(--color-text-tertiary)";

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
    <>
      {/* 확대 중일 때 원래 자리에 남는 안내 플레이스홀더 — 배경(다른 필드)은 그대로 편집 가능 */}
      {expanded && (
        <div style={{ border: "1px dashed var(--color-border)", borderRadius: 6, padding: "20px 16px", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 13, background: "var(--color-bg-muted)" }}>
          확대 창에서 편집 중입니다.
        </div>
      )}

      <div style={expanded ? {
        position:      "fixed",
        left:          panelPos.x,
        top:           panelPos.y,
        width:         panelSize.width,
        maxWidth:      "calc(100vw - 48px)",
        height:        panelSize.height,
        maxHeight:     "calc(100vh - 48px)",
        zIndex:        1500,
        display:       "flex",
        flexDirection: "column",
        border:        "1px solid var(--color-border)",
        borderRadius:  8,
        background:    "var(--color-bg-card)",
        boxShadow:     "0 8px 32px rgba(0,0,0,0.28)",
        overflow:      "hidden",
      } : {
        position:      "relative",
        display:       "flex",
        flexDirection: "column",
        flex:          fullHeight ? 1 : "none",
        minHeight:     0,
        height:        fullHeight ? "100%" : undefined,
      }}>

        {/* 확대 창 헤더 — 드래그 이동, 탭·폰트조절·닫기 */}
        {expanded && (
          <div
            onMouseDown={onPanelDragStart}
            style={{ cursor: "move", userSelect: "none", display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--color-bg-muted)", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", whiteSpace: "nowrap" }}>⠿ {title} (확대)</span>
            {onTabChange && <MarkdownTabButtons tab={tab} onTabChange={onTabChange} />}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
              <FontScaleControl />
              <button
                type="button"
                onClick={() => setExpanded(false)}
                style={{ padding: "3px 10px", fontSize: 11, fontWeight: 500, borderRadius: 4, border: "1px solid var(--color-border)", background: "var(--color-bg-card)", color: "var(--color-text-secondary)", cursor: "pointer", whiteSpace: "nowrap" }}
              >
                ✕ 닫기
              </button>
            </div>
          </div>
        )}

        {expanded && <PanelResizeHandle onMouseDown={onPanelResizeStart} />}

        {/* 확대 전 — 우상단 작은 확대 아이콘(레이아웃 공간 차지 안 함) */}
        {!expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            title="확대 창으로 편집 (폭이 좁아 답답할 때)"
            style={{ position: "absolute", top: 4, right: 4, zIndex: 5, padding: "1px 5px", fontSize: 11, borderRadius: 4, border: "1px solid var(--color-border)", background: "var(--color-bg-card)", color: "var(--color-text-secondary)", cursor: "pointer", opacity: 0.7 }}
          >
            ⤢
          </button>
        )}

      {tab === "edit" ? (
        <textarea
          value={value}
          placeholder={placeholder}
          readOnly={readOnly}
          // maxLength: field 지정 시 한도 강제. UTF-16 단위라 글자수보다 약간 후하게 끊지만
          // API 가 정확한 글자수로 다시 검증하므로 UI 는 1차 차단 역할.
          maxLength={max}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width:        "100%",
            height:       stretch ? "100%" : (rows * 21),
            padding:      "8px 12px",
            borderRadius: 6,
            border:       "1px solid var(--color-border)",
            background:   readOnly ? "var(--color-bg-muted)" : "var(--color-bg-card)",
            color:        "var(--color-text-primary)",
            boxSizing:    "border-box",
            outline:      "none",
            resize:       "none",
            fontFamily:   "var(--font-mono, monospace)",
            // 2026-05-29: 12 → 13. 단위업무/요구사항 등 장문 편집에서 답답함 해소
            fontSize:     13,
            lineHeight:   1.5,
            zoom:         fontScale,
            flex:         stretch ? 1 : "none",
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
            height:       stretch ? "100%" : (rows * 21),
            border:       "1px solid var(--color-border)",
            borderRadius: 6,
            background:   "#fff",
            flex:         stretch ? 1 : "none",
            minHeight:    stretch ? 0 : (rows * 21),
          }}
          title="HTML 미리보기"
        />
      ) : (
        <div
          ref={mdPreviewRef}
          className="sp-markdown"
          style={{
            width:        "100%",
            height:       stretch ? "100%" : (rows * 21),
            maxHeight:    stretch ? undefined : (rows * 21),
            padding:      "12px 16px",
            border:       "1px solid var(--color-border)",
            background:   "var(--color-bg-card)",
            color:        "var(--color-text-primary)",
            boxSizing:    "border-box",
            borderRadius: 6,
            overflowY:    "auto",
            zoom:         fontScale,
            flex:         stretch ? 1 : "none",
            minHeight:    stretch ? 0 : undefined,
          }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(value) || "<p style='color:#aaa;font-size:13px'>내용 없음</p>" }}
        />
      )}

      {/* 길이 카운터 — field 지정 시에만 노출. 우하단 정렬. */}
      {/* 비율 ≥80% 주황, ≥100% 빨강 — 사용자가 한도 임박 인지 가능. */}
      {field && max && (
        <div style={{
          marginTop:   4,
          fontSize:    11,
          color:       counterColor,
          textAlign:   "right",
          fontVariantNumeric: "tabular-nums",
          flexShrink:  0,
        }}>
          {current.toLocaleString()} / {max.toLocaleString()}
        </div>
      )}
      </div>
    </>
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
      {btn("edit",    "편집")}
      {btn("preview", "미리보기")}
    </div>
  );
}
