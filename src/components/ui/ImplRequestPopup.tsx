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

type LayerSummary = {
  type: string;
  displayId: string;
  name: string;
  mode: string;
  lineRatio: number;
};

type PromptTemplate = { id: string; name: string } | null;

// 모드 배지 색상
const MODE_BADGE: Record<string, { bg: string; color: string }> = {
  NO_CHANGE: { bg: "#e8f5e9", color: "#2e7d32" },
  DIFF:      { bg: "#fff3e0", color: "#e65100" },
  FULL:      { bg: "#fce4ec", color: "#c62828" },
  REPLACE:   { bg: "#fce4ec", color: "#c62828" },
  "신규":    { bg: "#e3f2fd", color: "#1565c0" },
};

// ── 컴포넌트 ─────────────────────────────────────────────────────────────────

export default function ImplRequestPopup({ projectId, entryType, entryId, functionIds, onClose, onSubmitted }: Props) {
  // AI 지시사항
  const [comentCn, setComentCn] = useState("");

  // 프롬프트 미리보기
  const [promptMd, setPromptMd] = useState("");
  const [summary, setSummary] = useState<LayerSummary[]>([]);
  const [promptTemplate, setPromptTemplate] = useState<PromptTemplate>(null);
  const [building, setBuilding] = useState(false);
  const [built, setBuilt] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // 미리보기(렌더링) vs 원본(raw) 토글
  const [viewMode, setViewMode] = useState<"preview" | "raw">("preview");
  // 최종 요청 컨펌 다이얼로그
  const [confirmOpen, setConfirmOpen] = useState(false);
  // 테이블 정보 치환 모드 (none = 원본 유지, brief = 컬럼명만, full = 컬럼표)
  const [tableMode, setTableMode] = useState<"none" | "brief" | "full">("none");

  // 모든 계층이 NO_CHANGE면 요청 불가
  const allNoChange = summary.length > 0 && summary.every((l) => l.mode === "NO_CHANGE");

  // 모드별 카운트 (요약 배지용)
  const modeCounts = summary.reduce<Record<string, number>>((acc, l) => {
    acc[l.mode] = (acc[l.mode] ?? 0) + 1;
    return acc;
  }, {});

  // 현재 프롬프트에 치환되지 않은 <TABLE_SCRIPT:xxx> 플레이스홀더가 남아있는지
  // - tableMode가 none이거나 미등록 테이블이 있으면 true
  // - diff 블록의 "- [삭제]" 라인은 과거 기록이므로 제외 (라인 단위 판정)
  const hasUnresolvedTableScript = promptMd.split("\n").some((line) => {
    if (line.startsWith("- [삭제]")) return false;
    return /<TABLE_SCRIPT:[^>]+>/.test(line);
  });

  // ── 팝업 열리면 자동으로 프롬프트 생성 ──
  // 코멘트 입력 후 "프롬프트 재생성" 가능하도록 수동 빌드도 지원
  useEffect(() => {
    // 최초 진입 시 자동 빌드 (코멘트 없이)
    handleBuild();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 프롬프트 생성 (build API) ──
  // tableMode 인자: 호출 시점의 모드를 명시적으로 전달 (state 비동기 문제 회피)
  async function handleBuild(modeOverride?: "none" | "brief" | "full") {
    setBuilding(true);
    try {
      const mode = modeOverride ?? tableMode;
      const r = await authFetch<{ data: { promptMd: string; summary: LayerSummary[]; promptTemplate: PromptTemplate } }>(
        `/api/projects/${projectId}/impl-request/build`,
        {
          method: "POST",
          body: JSON.stringify({ entryType, entryId, functionIds, tableMode: mode }),
        }
      );
      setPromptMd(r.data.promptMd);
      setSummary(r.data.summary ?? []);
      setPromptTemplate(r.data.promptTemplate ?? null);
      setBuilt(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "프롬프트 생성 실패");
    } finally {
      setBuilding(false);
    }
  }

  // 테이블 모드 변경 — 같은 모드 클릭 시 토글 해제(none), 다른 모드면 전환
  // 모드 변경 즉시 build API 재호출 (서버에서 치환)
  function handleTableModeClick(target: "brief" | "full") {
    const next: "none" | "brief" | "full" = tableMode === target ? "none" : target;
    setTableMode(next);
    handleBuild(next);
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
    <div data-impl-overlay="request" onClick={onClose} style={overlay}>
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
            {/* 복사 (클립보드) */}
            {built && promptMd && (
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(promptMd);
                    toast.success("프롬프트를 복사했습니다.");
                  } catch {
                    toast.error("복사에 실패했습니다.");
                  }
                }}
                title="프롬프트 클립보드 복사"
                style={{
                  padding: "4px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                  border: "1px solid var(--color-border)", background: "var(--color-bg-muted)",
                  color: "var(--color-text-secondary)", cursor: "pointer",
                }}
              >
                📋 복사
              </button>
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

        {/* ── 요약 배지 바 ── */}
        {built && summary.length > 0 && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
            padding: "10px 20px",
            background: "var(--color-bg-muted)",
            borderBottom: "1px solid var(--color-border)",
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)" }}>
              변경 현황 · 총 {summary.length}계층
            </span>
            <div style={{ width: 1, height: 14, background: "var(--color-border)" }} />
            {Object.entries(modeCounts).map(([mode, cnt]) => {
              const badge = MODE_BADGE[mode] ?? MODE_BADGE.NO_CHANGE;
              return (
                <span key={mode} style={{
                  fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
                  background: badge.bg, color: badge.color,
                }}>
                  {mode} {cnt}
                </span>
              );
            })}
            {allNoChange && (
              <span style={{ fontSize: 11, color: "#c62828", marginLeft: 4 }}>
                ⚠ 변경된 내용이 없어 요청할 수 없습니다.
              </span>
            )}

            {/* 테이블 치환 토글 — 우측 정렬, "?" 도움말 포함 */}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 11, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
                DB 테이블 치환
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toast.info(
                    "프롬프트의 <TABLE_SCRIPT:tb_xxx> 플레이스홀더를 실제 DB 테이블 정보로 치환합니다. 간략=컬럼명 목록, 상세=컬럼 표(타입·설명 포함). 미등록 테이블은 원본 그대로 유지됩니다.",
                    { duration: 7000 }
                  );
                }}
                title="도움말"
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 16, height: 16, borderRadius: "50%",
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg-card)",
                  color: "var(--color-text-secondary)",
                  fontSize: 10, fontWeight: 700,
                  cursor: "pointer", lineHeight: 1, padding: 0,
                  marginRight: 4,
                }}
              >
                ?
              </button>
              <button
                onClick={() => handleTableModeClick("brief")}
                disabled={building}
                title="컬럼명 목록으로 치환 (컨텍스트 절약)"
                style={{
                  padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                  border: "1px solid var(--color-border)",
                  background: tableMode === "brief" ? "rgba(103,80,164,0.15)" : "var(--color-bg-card)",
                  color: tableMode === "brief" ? "rgba(103,80,164,1)" : "var(--color-text-secondary)",
                  cursor: building ? "wait" : "pointer",
                  opacity: building ? 0.6 : 1,
                }}
              >
                {tableMode === "brief" ? "✓ " : ""}간략
              </button>
              <button
                onClick={() => handleTableModeClick("full")}
                disabled={building}
                title="컬럼 표(타입·설명 포함)로 치환"
                style={{
                  padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                  border: "1px solid var(--color-border)",
                  background: tableMode === "full" ? "rgba(103,80,164,0.15)" : "var(--color-bg-card)",
                  color: tableMode === "full" ? "rgba(103,80,164,1)" : "var(--color-text-secondary)",
                  cursor: building ? "wait" : "pointer",
                  opacity: building ? 0.6 : 1,
                }}
              >
                {tableMode === "full" ? "✓ " : ""}상세
              </button>
            </div>
          </div>
        )}

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
            <textarea
              value={comentCn}
              onChange={(e) => setComentCn(e.target.value)}
              placeholder="AI에게 전달할 추가 지시사항..."
              rows={2}
              style={{
                width: "100%", padding: "6px 10px", borderRadius: 6,
                border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
                color: "var(--color-text-primary)", fontSize: 12, outline: "none",
                boxSizing: "border-box", resize: "vertical",
              }}
            />
          </div>

          {/* 액션 버튼 */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={onClose} style={secBtn}>취소</button>
            <button
              onClick={() => {
                if (allNoChange) {
                  toast.error("변경된 내용이 없어 구현요청을 할 수 없습니다.");
                  return;
                }
                setConfirmOpen(true);
              }}
              disabled={submitting || !built || building}
              style={primaryBtn}
            >
              {submitting ? "요청 중..." : "최종 요청"}
            </button>
          </div>
        </div>
      </div>

      {/* ── 최종 요청 컨펌 다이얼로그 ── */}
      {confirmOpen && (
        <div
          onClick={() => !submitting && setConfirmOpen(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 520,
              background: "var(--color-bg-card)", border: "1px solid var(--color-border)",
              borderRadius: 12, boxShadow: "0 12px 48px rgba(0,0,0,0.25)", padding: "28px 32px",
            }}
          >
            {/* 헤더 */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
              <span style={{ fontSize: 22 }}>⚡</span>
              <div>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>
                  AI 구현 요청
                </p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>
                  아래 내용으로 AI에게 구현을 요청합니다.
                </p>
              </div>
            </div>

            {/* 프롬프트 템플릿 박스 */}
            <div style={{
              marginBottom: 16, padding: "12px 14px",
              background: "rgba(103,80,164,0.06)", border: "1px solid rgba(103,80,164,0.18)",
              borderRadius: 8,
            }}>
              {promptTemplate ? (
                <>
                  <p style={{ margin: "0 0 4px", fontSize: 11, color: "var(--color-text-secondary)", fontWeight: 600 }}>
                    ✅ 프롬프트 템플릿 찾았습니다
                  </p>
                  <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700, color: "rgba(103,80,164,1)" }}>
                    {promptTemplate.name}
                  </p>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)" }}>
                    해당 프롬프트와 함께 전달하도록 하겠습니다.
                  </p>
                </>
              ) : (
                <>
                  <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700, color: "#c62828" }}>
                    ⚠ 프롬프트 템플릿을 찾지 못했습니다
                  </p>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-primary)" }}>
                    시스템 프롬프트 없이 구현요청서만 전달됩니다.
                  </p>
                </>
              )}
            </div>

            {/* DB 테이블 치환 경고 — 플레이스홀더가 남아있으면 안내 */}
            {hasUnresolvedTableScript && (
              <div style={{
                marginBottom: 16, padding: "10px 14px",
                background: "#fff8e1", border: "1px solid #ffe082",
                borderRadius: 8, fontSize: 12, lineHeight: 1.6,
              }}>
                <p style={{ margin: "0 0 4px", fontWeight: 700, color: "#e65100" }}>
                  ⚠ DB 테이블 정보가 치환되지 않았습니다
                </p>
                <p style={{ margin: 0, color: "var(--color-text-secondary)" }}>
                  프롬프트에 <code style={{ background: "#fff3e0", padding: "0 4px", borderRadius: 2 }}>&lt;TABLE_SCRIPT:tb_xxx&gt;</code> 플레이스홀더가 남아있습니다.
                  상단의 <strong>간략 / 상세</strong> 버튼으로 치환하면 AI가 테이블 구조를 정확히 파악합니다.
                  이대로 요청하시겠습니까?
                </p>
              </div>
            )}

            {/* 전달되는 내용 */}
            <div style={{ marginBottom: 22, fontSize: 13, lineHeight: 1.7 }}>
              <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--color-text-primary)" }}>
                전달되는 내용
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {promptTemplate && (
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={confirmBadgeStyle}>시스템 프롬프트</span>
                    <span style={{ color: "var(--color-text-secondary)" }}>{promptTemplate.name}</span>
                  </div>
                )}
                {comentCn.trim() && (
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={confirmBadgeStyle}>코멘트</span>
                    <span style={{
                      color: "var(--color-text-secondary)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 340,
                    }}>
                      {comentCn.trim()}
                    </span>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={confirmBadgeStyle}>구현요청서</span>
                  <span style={{ color: "var(--color-text-secondary)" }}>
                    {summary.length}계층 · {Object.entries(modeCounts).map(([m, c]) => `${m} ${c}`).join(" · ")}
                  </span>
                </div>
              </div>
            </div>

            {/* 버튼 */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={submitting}
                style={secBtn}
              >
                취소
              </button>
              <button
                onClick={async () => { await handleSubmit(); setConfirmOpen(false); }}
                disabled={submitting}
                style={{ ...primaryBtn, background: "rgba(103,80,164,1)" }}
              >
                {submitting ? "요청 중..." : "요청"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const confirmBadgeStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 4,
  background: "rgba(103,80,164,0.12)", color: "rgba(103,80,164,0.9)",
  flexShrink: 0,
};

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
