"use client";

/**
 * ActivityMdModal — "최근 주간 활동 MD" 팝업
 *
 * AI 초안 생성(POST /weekly-reports)에 실제로 전달되는 것과 완전히 같은 텍스트를
 * GET /weekly-reports/export-md 로 그대로 받아 보여준다. 팀 AI 태스크 큐를 거치지 않고,
 * 사용자가 이 내용을 복사해서 개인 Claude 대화에 붙여넣어 직접 주간보고를 요청할 수도 있다.
 */

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

export default function ActivityMdModal({
  projectId,
  weekMonday,
  onClose,
}: {
  projectId: string;
  weekMonday: string;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["weekly-report-export-md", projectId, weekMonday],
    queryFn: () =>
      authFetch<{ data: { md: string } }>(
        `/api/projects/${projectId}/weekly-reports/export-md?weekStartDt=${weekMonday}`
      ).then((r) => r.data),
  });

  async function handleCopy() {
    if (!data?.md) return;
    await navigator.clipboard.writeText(data.md);
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "var(--color-bg-overlay)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(820px, 95vw)", maxHeight: "85vh",
          background: "var(--color-bg-card)", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-muted)",
        }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>최근 주간 활동 MD</div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", marginTop: 2 }}>
              "AI 요청"이 실제로 전달받는 내용과 동일합니다 — 복사해서 개인 Claude 대화에 붙여넣어 직접 요청할 수도 있어요.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--color-text-secondary)", padding: "0 4px", lineHeight: 1 }}
          >×</button>
        </div>

        <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
          {isLoading && <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>불러오는 중...</div>}
          {error && <div style={{ fontSize: "var(--text-sm)", color: "var(--color-error)" }}>불러오지 못했습니다.</div>}
          {data && (
            <textarea
              readOnly
              value={data.md}
              className="sp-input"
              style={{ width: "100%", minHeight: 420, fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", resize: "vertical" }}
              onFocus={(e) => e.currentTarget.select()}
            />
          )}
        </div>

        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--color-border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="sp-btn sp-btn-ghost sp-btn-sm" onClick={onClose}>닫기</button>
          <button type="button" className="sp-btn sp-btn-primary sp-btn-sm" disabled={!data?.md} onClick={handleCopy}>
            복사하기
          </button>
        </div>
      </div>
    </div>
  );
}
