"use client";

/**
 * AiRequestCommentModal — "AI 요청/재생성" 클릭 시 뜨는 추가 코멘트 팝업
 *
 * 주간보고 요청 자체(업무일지 수집 등)는 이미 자동으로 되니, PM이 이번 생성에만 특별히
 * 반영하고 싶은 말이 있으면 여기서 남긴다. 입력값은 weeklyReportPrompt.ts가 조립하는
 * 프롬프트에 <PM 추가 요청사항> 태그로 그대로 들어간다 — 비워두고 바로 요청해도 된다.
 */

import { useState } from "react";

export default function AiRequestCommentModal({
  isRegenerate,
  submitting,
  onCancel,
  onSubmit,
}: {
  isRegenerate: boolean;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (comment: string) => void;
}) {
  const [comment, setComment] = useState("");

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "var(--color-bg-overlay)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200 }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(520px, 95vw)",
          background: "var(--color-bg-card)", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        <div style={{
          padding: "14px 20px", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-muted)",
        }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
            {isRegenerate ? "AI 재생성" : "AI 요청"}
          </div>
        </div>

        <div style={{ padding: 20 }}>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)", marginBottom: 10, lineHeight: 1.5 }}>
            혹시 추가로 코멘트 하실 게 있나요? 주간보고 요청은 이미 자동으로 되고, 추가로 할 말이 있으면 적어주세요.
          </div>
          <textarea
            className="sp-input"
            rows={4}
            autoFocus
            value={comment}
            placeholder="예) 이번 주는 인프라 이슈 위주로 정리해줘 / 차주 계획에 코드리뷰 항목 포함해줘"
            onChange={(e) => setComment(e.target.value)}
          />
        </div>

        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--color-border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="sp-btn sp-btn-ghost sp-btn-sm" onClick={onCancel} disabled={submitting}>취소</button>
          <button type="button" className="sp-btn sp-btn-primary sp-btn-sm" onClick={() => onSubmit(comment)} disabled={submitting}>
            {submitting ? "요청 중..." : isRegenerate ? "재생성 요청" : "요청"}
          </button>
        </div>
      </div>
    </div>
  );
}
