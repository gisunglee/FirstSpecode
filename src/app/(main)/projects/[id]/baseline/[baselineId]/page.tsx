"use client";

/**
 * BaselineDetailPage — 기준선 스냅샷 상세 (FID-00125)
 *
 * 역할:
 *   - 좌측: 요구사항 목록 (클릭 시 우측에 내용 표시)
 *   - 우측: 원문/현행화 탭 (HTML 렌더링) + 상세 명세 (마크다운 미리보기/원본)
 */

import { Suspense, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { marked } from "marked";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type SnapshotReq = {
  reqId:    string;
  displayId: string;
  name:     string;
  priority: string | null;
  source:   string | null;
  orgnlCn:  string;
  curncyCn: string;
  specCn:   string;
};

type BaselineDetail = {
  baselineId:  string;
  name:        string;
  comment:     string;
  confirmedAt: string;
  items:       SnapshotReq[];
  totalCount:  number;
};

const PRIORITY_MAP: Record<string, { label: string; color: string; bg: string }> = {
  HIGH:   { label: "높음", color: "#c62828", bg: "#ffebee" },
  MEDIUM: { label: "중간", color: "#f57f17", bg: "#fff8e1" },
  LOW:    { label: "낮음", color: "#2e7d32", bg: "#e8f5e9" },
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function BaselineDetailPage() {
  return (
    <Suspense fallback={null}>
      <BaselineDetailPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function BaselineDetailPageInner() {
  const params     = useParams<{ id: string; baselineId: string }>();
  const router     = useRouter();
  const projectId  = params.id;
  const baselineId = params.baselineId;

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["baseline-requirements", projectId, baselineId],
    queryFn:  () =>
      authFetch<{ data: BaselineDetail }>(
        `/api/projects/${projectId}/baseline/${baselineId}/requirements`
      ).then((r) => r.data),
  });

  const items = data?.items ?? [];
  const effectiveId = selectedId ?? (items.length > 0 ? items[0].reqId : null);
  const selected = items.find((r) => r.reqId === effectiveId) ?? null;

  if (isLoading) {
    return <div style={{ padding: "40px 32px", color: "#888" }}>로딩 중...</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: 0 }}>
      {/* 헤더 */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 24px", minHeight: 52,
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        flexShrink: 0,
        gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => router.push(`/projects/${projectId}/baseline`)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", padding: "0 4px", lineHeight: 1 }}
          >
            ←
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>기준선 상세</span>
          {data?.name && (
            <span style={{ fontSize: 13, color: "var(--color-text-secondary)", marginLeft: 4 }}>
              · {data.name}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
          {data?.confirmedAt && (
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              확정일시&nbsp;
              <strong style={{ color: "var(--color-text-primary)" }}>
                {new Date(data.confirmedAt).toLocaleString("ko-KR", {
                  year: "numeric", month: "2-digit", day: "2-digit",
                  hour: "2-digit", minute: "2-digit", hour12: false,
                })}
              </strong>
            </span>
          )}
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
            요구사항&nbsp;<strong style={{ color: "var(--color-text-primary)" }}>{data?.totalCount ?? 0}건</strong>
          </span>
        </div>
      </div>

      {/* 확정 코멘트 배너 */}
      {data?.comment && (
        <div style={{
          padding: "10px 24px", flexShrink: 0,
          background: "#fffbeb", borderBottom: "1px solid #fde68a",
          fontSize: 13, color: "#92400e",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ fontWeight: 600, flexShrink: 0 }}>확정 코멘트</span>
          <span style={{ color: "var(--color-text-primary)" }}>{data.comment}</span>
        </div>
      )}

      {/* 바디 */}
      {items.length === 0 ? (
        <div style={{ padding: "60px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
          스냅샷 데이터가 없습니다.
        </div>
      ) : (
        <div style={{ display: "flex", flex: 1, overflow: "hidden", padding: "16px 24px", gap: 16 }}>

          {/* 좌측 — 요구사항 목록 */}
          <div style={{
            width: 240, flexShrink: 0,
            border: "1px solid var(--color-border)",
            borderRadius: 8, overflow: "hidden",
            display: "flex", flexDirection: "column",
            background: "var(--color-bg-card)",
          }}>
            <div style={{
              padding: "10px 14px",
              background: "var(--color-bg-muted)",
              borderBottom: "1px solid var(--color-border)",
              fontSize: 11, fontWeight: 700,
              color: "var(--color-text-secondary)",
              letterSpacing: "0.08em", textTransform: "uppercase",
            }}>
              요구사항 목록 ({items.length})
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              {items.map((req, idx) => {
                const isActive = req.reqId === effectiveId;
                const pr = req.priority ? PRIORITY_MAP[req.priority] : null;
                return (
                  <div
                    key={req.reqId}
                    onClick={() => setSelectedId(req.reqId)}
                    style={{
                      padding: "10px 14px",
                      borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                      cursor: "pointer",
                      background: isActive ? "var(--color-primary-bg, #e3f2fd)" : "var(--color-bg-card)",
                      borderLeft: isActive ? "3px solid var(--color-primary, #1976d2)" : "3px solid transparent",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, overflow: "hidden" }}>
                      <span style={{ fontSize: 11, color: "#aaa", flexShrink: 0 }}>{req.displayId}</span>
                      <span style={{
                        fontSize: 13, fontWeight: isActive ? 600 : 400,
                        color: isActive ? "var(--color-primary, #1976d2)" : "var(--color-text-primary)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {req.name}
                      </span>
                    </div>
                    {pr && (
                      <span style={{
                        display: "inline-block", marginTop: 4,
                        padding: "1px 6px", borderRadius: 4,
                        fontSize: 10, fontWeight: 600,
                        background: pr.bg, color: pr.color,
                      }}>
                        {pr.label}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 우측 — 상세 */}
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, maxWidth: 800 }}>
            {selected ? (
              <ReqDetail req={selected} />
            ) : (
              <div style={{ padding: "60px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
                좌측 목록에서 요구사항을 선택하세요.
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

// ── 요구사항 상세 컴포넌트 ────────────────────────────────────────────────────

function ReqDetail({ req }: { req: SnapshotReq }) {
  // 원문/현행화 탭
  const [htmlTab, setHtmlTab] = useState<"orgnl" | "curncy">("orgnl");
  // 상세 명세 뷰 모드
  const [specMode, setSpecMode] = useState<"preview" | "source">("preview");

  const specHtml = useMemo(() => {
    if (!req.specCn) return "";
    try {
      return marked.parse(req.specCn) as string;
    } catch {
      return req.specCn;
    }
  }, [req.specCn]);

  const pr = req.priority ? PRIORITY_MAP[req.priority] : null;

  return (
    <>
      {/* 제목 카드 */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-primary, #1976d2)", flexShrink: 0 }}>{req.displayId}</span>
          {pr && (
            <span style={{
              padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
              background: pr.bg, color: pr.color, flexShrink: 0,
            }}>
              {pr.label}
            </span>
          )}
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>
            {req.name}
          </span>
        </div>
      </div>

      {/* 원문 / 현행화 탭 카드 */}
      {(req.orgnlCn || req.curncyCn) && (
        <div style={cardStyle}>
          {/* 탭 헤더 */}
          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--color-border)", marginBottom: 16 }}>
            {(["orgnl", "curncy"] as const).map((tab) => {
              const label = tab === "orgnl" ? "원문" : "현행화";
              const active = htmlTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setHtmlTab(tab)}
                  style={{
                    padding: "7px 18px",
                    border: "none",
                    borderBottom: active ? "2px solid var(--color-primary, #1976d2)" : "2px solid transparent",
                    background: "none",
                    cursor: "pointer",
                    fontSize: 13, fontWeight: active ? 700 : 400,
                    color: active ? "var(--color-primary, #1976d2)" : "var(--color-text-secondary)",
                    marginBottom: -1,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* 탭 내용 — HTML 렌더링 */}
          <div
            style={{
              minHeight: 80,
              fontSize: 13,
              lineHeight: 1.7,
              color: "var(--color-text-primary)",
            }}
            dangerouslySetInnerHTML={{
              __html: (htmlTab === "orgnl" ? req.orgnlCn : req.curncyCn) ?? "",
            }}
          />
        </div>
      )}

      {/* 상세 명세 카드 */}
      {req.specCn && (
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={cardLabelStyle}>상세 명세</div>
            <div style={{ display: "flex", gap: 4 }}>
              {(["preview", "source"] as const).map((mode) => {
                const active = specMode === mode;
                return (
                  <button
                    key={mode}
                    onClick={() => setSpecMode(mode)}
                    style={{
                      padding: "3px 10px", borderRadius: 4,
                      border: "1px solid var(--color-border)",
                      fontSize: 11, fontWeight: active ? 700 : 400,
                      cursor: "pointer",
                      background: active ? "var(--color-primary, #1976d2)" : "var(--color-bg-card)",
                      color: active ? "#fff" : "var(--color-text-secondary)",
                    }}
                  >
                    {mode === "preview" ? "미리보기" : "원본"}
                  </button>
                );
              })}
            </div>
          </div>

          {specMode === "preview" ? (
            <div
              style={{ fontSize: 13, lineHeight: 1.8, color: "var(--color-text-primary)" }}
              className="markdown-body"
              dangerouslySetInnerHTML={{ __html: specHtml }}
            />
          ) : (
            <pre style={{
              margin: 0,
              fontFamily: "'Consolas', 'Monaco', monospace",
              fontSize: 12,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: "var(--color-text-primary)",
              lineHeight: 1.7,
              background: "var(--color-bg-muted)",
              padding: "12px 14px",
              borderRadius: 6,
              border: "1px solid var(--color-border)",
            }}>
              {req.specCn}
            </pre>
          )}
        </div>
      )}
    </>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  padding: "16px 20px",
  boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
};

const cardLabelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700,
  letterSpacing: "0.08em", textTransform: "uppercase",
  color: "var(--color-text-secondary)",
};
