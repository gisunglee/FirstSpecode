"use client";

/**
 * ImplRequestPopup — 구현요청 프롬프트 미리보기 + 최종 요청 팝업
 *
 * 역할:
 *   - ImplTargetDialog에서 선택된 기능 ID 목록을 받아
 *   - build API 호출 → 프롬프트 생성 → 미리보기 표시
 *   - 사용자 확인 후 submit API 호출 → tb_ai_task INSERT + 스냅샷 저장
 *
 * Props:
 *   - projectId:   프로젝트 ID
 *   - entryType:   진입점 계층 (UNIT_WORK | SCREEN | AREA | FUNCTION)
 *   - entryId:     진입점 엔티티 ID
 *   - functionIds: ImplTargetDialog에서 선택된 기능 ID 배열
 *   - onClose:     팝업 닫기
 *   - onSubmitted:  최종 요청 완료 후 콜백 (캐시 무효화 등)
 */

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { renderMarkdown } from "@/lib/renderMarkdown";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type Props = {
  projectId: string;
  entryType: "UNIT_WORK" | "SCREEN" | "AREA" | "FUNCTION";
  entryId: string;
  functionIds: string[];
  onClose: () => void;
  onSubmitted?: () => void;
};

// ── 컴포넌트 ─────────────────────────────────────────────────────────────────

export default function ImplRequestPopup({ projectId, entryType, entryId, functionIds, onClose, onSubmitted }: Props) {
  // AI 지시사항
  const [comentCn, setComentCn] = useState("");

  // 프롬프트 미리보기
  const [promptMd, setPromptMd] = useState("");
  const [building, setBuilding] = useState(false);
  const [built, setBuilt] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // 미리보기(렌더링) vs 원본(raw) 토글
  const [viewMode, setViewMode] = useState<"preview" | "raw">("preview");

  // ── 팝업 열리면 자동으로 프롬프트 생성 ──
  // 코멘트 입력 후 "프롬프트 재생성" 가능하도록 수동 빌드도 지원
  useEffect(() => {
    // 최초 진입 시 자동 빌드 (코멘트 없이)
    handleBuild();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 프롬프트 생성 (build API) ──
  async function handleBuild() {
    setBuilding(true);
    try {
      const r = await authFetch<{ data: { promptMd: string } }>(`/api/projects/${projectId}/impl-request/build`, {
        method: "POST",
        body: JSON.stringify({
          entryType,
          entryId,
          functionIds,
          comentCn: comentCn || undefined,
        }),
      });
      setPromptMd(r.data.promptMd);
      setBuilt(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "프롬프트 생성 실패");
    } finally {
      setBuilding(false);
    }
  }

  // ── 최종 요청 (submit API) ──
  async function handleSubmit() {
    setSubmitting(true);
    try {
      await authFetch(`/api/projects/${projectId}/impl-request/submit`, {
        method: "POST",
        body: JSON.stringify({
          entryType,
          entryId,
          functionIds,
          comentCn: comentCn || undefined,
          promptMd,
        }),
      });
      toast.success("구현 요청이 등록되었습니다.");
      onSubmitted?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "요청 등록 실패");
    } finally {
      setSubmitting(false);
    }
  }

  // ── 렌더링 ──
  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={dialogStyle}>

        {/* ── 헤더 ── */}
        <div style={headerStyle}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>구현 요청 — 프롬프트 미리보기</div>
            <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>
              아래 내용으로 AI에게 요청합니다. 확인 후 최종 요청하세요.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* 미리보기 / 원본 토글 */}
            {built && promptMd && (
              <div style={{ display: "flex", border: "1px solid var(--color-border)", borderRadius: 4, overflow: "hidden" }}>
                <button
                  onClick={() => setViewMode("preview")}
                  style={{
                    padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                    border: "none", borderRight: "1px solid var(--color-border)",
                    background: viewMode === "preview" ? "var(--color-primary, #1976d2)" : "var(--color-bg-muted)",
                    color: viewMode === "preview" ? "#fff" : "var(--color-text-secondary)",
                  }}
                >
                  미리보기
                </button>
                <button
                  onClick={() => setViewMode("raw")}
                  style={{
                    padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                    border: "none",
                    background: viewMode === "raw" ? "var(--color-primary, #1976d2)" : "var(--color-bg-muted)",
                    color: viewMode === "raw" ? "#fff" : "var(--color-text-secondary)",
                  }}
                >
                  원본
                </button>
              </div>
            )}
            {/* MD 다운로드 */}
            {built && promptMd && (
              <button
                onClick={() => {
                  const blob = new Blob([promptMd], { type: "text/markdown;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "프롬프트.md";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                title="프롬프트.md 다운로드"
                style={{
                  padding: "4px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                  border: "1px solid var(--color-border)", background: "var(--color-bg-muted)",
                  color: "var(--color-text-secondary)", cursor: "pointer",
                }}
              >
                ↓ MD
              </button>
            )}
            <button onClick={onClose} style={closeBtn}>×</button>
          </div>
        </div>

        {/* ── 본문: 프롬프트 미리보기 ── */}
        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
          {building ? (
            <div style={{ padding: 40, textAlign: "center", color: "#aaa", fontSize: 13 }}>
              프롬프트 생성 중...
            </div>
          ) : !built ? (
            <div style={{ padding: 40, textAlign: "center", color: "#aaa", fontSize: 13 }}>
              프롬프트를 생성할 수 없습니다.
            </div>
          ) : viewMode === "preview" ? (
            <div
              className="sp-markdown"
              style={{ fontSize: 14, lineHeight: 1.8, color: "var(--color-text-primary)" }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(promptMd) }}
            />
          ) : (
            /* 원본 보기 — 마크다운 소스 그대로 표시 */
            <pre style={{
              fontSize: 13, lineHeight: 1.7, color: "var(--color-text-primary)",
              whiteSpace: "pre-wrap", wordBreak: "break-word",
              background: "var(--color-bg-muted)", padding: 16, borderRadius: 8,
              border: "1px solid var(--color-border)", margin: 0,
              fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
            }}>
              {promptMd}
            </pre>
          )}
        </div>

        {/* ── 하단: AI 지시사항 + 버튼 ── */}
        <div style={{ borderTop: "1px solid var(--color-border)", padding: "12px 20px", flexShrink: 0 }}>
          {/* AI 지시사항 입력 */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: "var(--color-text-secondary)" }}>
              AI 지시사항 (선택)
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <textarea
                value={comentCn}
                onChange={(e) => setComentCn(e.target.value)}
                placeholder="AI에게 전달할 추가 지시사항..."
                rows={2}
                style={{
                  flex: 1, padding: "6px 10px", borderRadius: 6,
                  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
                  color: "var(--color-text-primary)", fontSize: 12, outline: "none",
                  boxSizing: "border-box", resize: "vertical",
                }}
              />
              {/* 코멘트 변경 후 프롬프트 재생성 버튼 */}
              <button
                onClick={handleBuild}
                disabled={building}
                style={{
                  ...secBtn,
                  fontSize: 11, padding: "6px 12px", whiteSpace: "nowrap", flexShrink: 0,
                }}
              >
                {building ? "생성 중..." : "프롬프트 재생성"}
              </button>
            </div>
          </div>

          {/* 액션 버튼 */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={onClose} style={secBtn}>취소</button>
            <button
              onClick={handleSubmit}
              disabled={submitting || !built || building}
              style={primaryBtn}
            >
              {submitting ? "요청 중..." : "최종 요청"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 스타일 ───────────────────────────────────────────────────────────────────

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100,
};

const dialogStyle: React.CSSProperties = {
  background: "var(--color-bg-card)", borderRadius: 12,
  width: "60vw", maxWidth: 1400, maxHeight: "90vh",
  display: "flex", flexDirection: "column",
  boxShadow: "0 12px 40px rgba(0,0,0,0.25)", overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "16px 20px", borderBottom: "1px solid var(--color-border)", flexShrink: 0,
};

const closeBtn: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#999",
};

const primaryBtn: React.CSSProperties = {
  padding: "6px 18px", borderRadius: 6, border: "none",
  background: "var(--color-primary, #1976d2)", color: "#fff",
  fontSize: 13, fontWeight: 600, cursor: "pointer",
};

const secBtn: React.CSSProperties = {
  padding: "6px 18px", borderRadius: 6,
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-primary)", fontSize: 13, cursor: "pointer",
};
