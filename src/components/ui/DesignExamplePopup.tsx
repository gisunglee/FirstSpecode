"use client";

/**
 * DesignExamplePopup — 설계 양식 "예시" 팝업 공용 컴포넌트
 *
 * 역할:
 *   - 5계층 상세 페이지가 각각 별도로 갖고 있던
 *     ExamplePopup / ScreenExamplePopup / AreaExamplePopup / FuncExamplePopup /
 *     SpecExamplePopup 을 하나로 통합.
 *   - 미리보기(marked 파싱) / 원문(<pre>) 탭 + 복사 버튼 + 닫기
 *
 * 사용:
 *   {exampleOpen && dt?.exampleCn && (
 *     <DesignExamplePopup
 *       title={`${label} 설명 예시`}
 *       contentMd={dt.exampleCn}
 *       onClose={() => setExampleOpen(false)}
 *     />
 *   )}
 */

import { useState } from "react";
import { marked } from "marked";

type Props = {
  title:     string;
  contentMd: string;
  onClose:   () => void;
};

// 모든 계층에 공통으로 적용할 스코프 클래스 — dangerouslySetInnerHTML로 주입되는 HTML에 한해 적용
const EXAMPLE_CSS = [
  ".dt-example h2,.dt-example h3,.dt-example h4{font-size:14px;font-weight:700;margin:16px 0 8px}",
  ".dt-example table{border-collapse:collapse;width:100%;margin-bottom:12px}",
  ".dt-example th,.dt-example td{border:1px solid #e0e0e0;padding:5px 10px;font-size:12px}",
  ".dt-example th{background:#f5f5f5;font-weight:600}",
  ".dt-example pre{background:#f5f5f5;padding:10px 14px;border-radius:6px;font-size:12px;overflow-x:auto}",
  ".dt-example code{font-family:monospace}",
  ".dt-example ul{padding-left:18px;margin:4px 0}",
  ".dt-example strong{font-weight:700}",
].join(" ");

function parseMarkdown(md: string): string {
  const r = marked.parse(md, { async: false });
  return typeof r === "string" ? r : "";
}

export default function DesignExamplePopup({ title, contentMd, onClose }: Props) {
  const [tab, setTab]       = useState<"raw" | "preview">("preview");
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(contentMd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  const tabBtn = (t: "raw" | "preview", label: string) => (
    <button
      onClick={() => setTab(t)}
      style={{
        padding: "4px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
        borderRadius: 5, border: "none",
        background: tab === t ? "var(--color-primary, #1976d2)" : "transparent",
        color:      tab === t ? "#fff" : "var(--color-text-secondary)",
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
        zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--color-bg-card)", borderRadius: 10,
          width: "min(780px, 92vw)", maxHeight: "84vh",
          display: "flex", flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: "1px solid var(--color-border)", gap: 12,
        }}>
          <span style={{ fontSize: 15, fontWeight: 700, flexShrink: 0 }}>{title}</span>
          <div style={{ display: "flex", gap: 2, background: "var(--color-bg-muted)", padding: 3, borderRadius: 7 }}>
            {tabBtn("preview", "미리보기")}
            {tabBtn("raw", "원문")}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
            <button
              onClick={handleCopy}
              style={{
                padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                borderRadius: 5, border: "1px solid var(--color-border)",
                background: copied ? "#e8f5e9" : "var(--color-bg-base)",
                color:      copied ? "#2e7d32" : "var(--color-text-secondary)",
                transition: "all 0.2s",
              }}
            >
              {copied ? "✓ 복사됨" : "복사"}
            </button>
            <button
              onClick={onClose}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 20, color: "var(--color-text-secondary)", lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* 본문 */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {tab === "raw" ? (
            <pre style={{
              margin: 0, fontSize: 13, lineHeight: 1.7,
              whiteSpace: "pre-wrap",
              color: "var(--color-text-primary)", fontFamily: "monospace",
            }}>
              {contentMd}
            </pre>
          ) : (
            <>
              <style dangerouslySetInnerHTML={{ __html: EXAMPLE_CSS }} />
              <div
                className="dt-example"
                style={{ fontSize: 13, lineHeight: 1.8, color: "var(--color-text-primary)" }}
                dangerouslySetInnerHTML={{ __html: parseMarkdown(contentMd) }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
