"use client";

/**
 * BaselinePage — 기준선 스냅샷 관리 (PID-00038)
 *
 * 역할:
 *   - 기준선 목록 조회 (FID-00123)
 *   - 전체 요구사항 일괄 확정 (FID-00124)
 *   - 기준선 클릭 → 스냅샷 요구사항 목록 조회 (FID-00125)
 */

import { Suspense, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type BaselineItem = {
  baselineId:       string;
  name:             string;
  comment:          string;
  requirementCount: number;
  confirmedAt:      string;
  confirmerEmail:   string;
};

type SnapshotReq = {
  reqId:     string;
  displayId: string;
  name:      string;
  priority:  string | null;
  source:    string | null;
  orgnlCn:   string;
  curncyCn:  string;
  specCn:    string;
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function BaselinePage() {
  return (
    <Suspense fallback={null}>
      <BaselinePageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function BaselinePageInner() {
  const params      = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const projectId   = params.id;

  const [createOpen,     setCreateOpen]     = useState(false);
  const [selectedBaseline, setSelectedBaseline] = useState<BaselineItem | null>(null);

  // ── 기준선 목록 ────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ["baselines", projectId],
    queryFn:  () =>
      authFetch<{ data: { items: BaselineItem[]; totalCount: number } }>(
        `/api/projects/${projectId}/baseline`
      ).then((r) => r.data),
  });

  const items = data?.items ?? [];

  if (isLoading) {
    return <div style={{ padding: "40px 32px", color: "#888" }}>로딩 중...</div>;
  }

  return (
    <div style={{ padding: "32px" }}>
      {/* 헤더 AR-00055 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text-primary)" }}>
            기준선 목록
          </div>
        </div>
        <button onClick={() => setCreateOpen(true)} style={primaryBtnStyle}>
          일괄 확정
        </button>
      </div>

      <div style={{ marginBottom: 16, fontSize: 14, color: "var(--color-text-secondary)" }}>
        총 {data?.totalCount ?? 0}건
      </div>

      {/* 기준선 목록 그리드 (AR-00056) */}
      {items.length === 0 ? (
        <div style={{ padding: "60px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
          저장된 기준선이 없습니다.
        </div>
      ) : (
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
          {/* 헤더 행 */}
          <div style={gridHeaderStyle}>
            <div>#</div>
            <div>기준선명</div>
            <div>확정일시</div>
            <div>확정자</div>
            <div>요구사항 수</div>
          </div>

          {/* 데이터 행 */}
          {items.map((item, idx) => (
            <div
              key={item.baselineId}
              style={{
                ...gridRowStyle,
                borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
              }}
            >
              <div style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>{idx + 1}</div>

              {/* 기준선명 — 클릭 시 스냅샷 조회 */}
              <div>
                <button
                  onClick={() => setSelectedBaseline(item)}
                  style={linkBtnStyle}
                >
                  {item.name}
                </button>
                {item.comment && (
                  <span style={{ fontSize: 12, color: "#888", marginLeft: 8 }}>{item.comment}</span>
                )}
              </div>

              <div style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>
                {new Date(item.confirmedAt).toLocaleString("ko-KR", {
                  year: "numeric", month: "2-digit", day: "2-digit",
                  hour: "2-digit", minute: "2-digit",
                })}
              </div>

              <div style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>
                {item.confirmerEmail || "-"}
              </div>

              <div>
                <span style={{
                  display: "inline-block", padding: "2px 10px", borderRadius: 4,
                  fontSize: 12, fontWeight: 600,
                  background: "var(--color-bg-muted)", color: "var(--color-text-secondary)",
                }}>
                  {item.requirementCount}건
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 일괄 확정 팝업 */}
      {createOpen && (
        <CreateBaselinePopup
          projectId={projectId}
          onClose={() => setCreateOpen(false)}
          onSuccess={() => {
            setCreateOpen(false);
            queryClient.invalidateQueries({ queryKey: ["baselines", projectId] });
          }}
        />
      )}

      {/* 스냅샷 요구사항 목록 팝업 (FID-00125) */}
      {selectedBaseline && (
        <SnapshotViewPopup
          projectId={projectId}
          baseline={selectedBaseline}
          onClose={() => setSelectedBaseline(null)}
        />
      )}
    </div>
  );
}

// ── 일괄 확정 팝업 ────────────────────────────────────────────────────────────

function CreateBaselinePopup({
  projectId,
  onClose,
  onSuccess,
}: {
  projectId: string;
  onClose:   () => void;
  onSuccess: () => void;
}) {
  const [name,    setName]    = useState("");
  const [comment, setComment] = useState("");

  const createMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/baseline`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name: name.trim(), comment: comment.trim() }),
      }),
    onSuccess: () => {
      toast.success("기준선이 저장되었습니다.");
      onSuccess();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSubmit() {
    if (!name.trim()) {
      toast.error("기준선명을 입력해 주세요.");
      return;
    }
    createMutation.mutate();
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>전체 요구사항 일괄 확정</h3>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--color-text-secondary)" }}>
          현재 프로젝트의 모든 요구사항을 스냅샷으로 저장합니다.
        </p>

        <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>
          기준선명 <span style={{ color: "#e53935" }}>*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="예: 1차 기준선, v1.0 릴리스"
          style={{ ...inputStyle, marginBottom: 16 }}
          autoFocus
        />

        <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>
          확정 코멘트 <span style={{ fontWeight: 400, color: "#888" }}>(선택)</span>
        </label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="기준선 생성 사유를 입력해 주세요..."
          rows={3}
          style={{ ...inputStyle, resize: "vertical", marginBottom: 20 }}
        />

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={secondaryBtnStyle} disabled={createMutation.isPending}>
            취소
          </button>
          <button onClick={handleSubmit} style={primaryBtnStyle} disabled={createMutation.isPending}>
            {createMutation.isPending ? "저장 중..." : "일괄 확정"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 스냅샷 요구사항 목록 팝업 (FID-00125) ────────────────────────────────────

function SnapshotViewPopup({
  projectId,
  baseline,
  onClose,
}: {
  projectId: string;
  baseline:  BaselineItem;
  onClose:   () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["baseline-requirements", projectId, baseline.baselineId],
    queryFn:  () =>
      authFetch<{ data: { items: SnapshotReq[]; totalCount: number; name: string; confirmedAt: string } }>(
        `/api/projects/${projectId}/baseline/${baseline.baselineId}/requirements`
      ).then((r) => r.data),
  });

  const items = data?.items ?? [];

  return (
    <div style={{ ...overlayStyle, alignItems: "flex-start", overflowY: "auto" }} onClick={onClose}>
      <div
        style={{
          background:   "var(--color-bg-card)",
          borderRadius: 10,
          padding:      "28px 32px",
          width:        "90vw",
          maxWidth:     900,
          margin:       "40px auto",
          boxShadow:    "0 8px 32px rgba(0,0,0,0.18)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{baseline.name}</div>
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 4 }}>
              확정일: {new Date(baseline.confirmedAt).toLocaleString("ko-KR", {
                year: "numeric", month: "2-digit", day: "2-digit",
                hour: "2-digit", minute: "2-digit",
              })} · 요구사항 {baseline.requirementCount}건
            </div>
          </div>
          <button onClick={onClose} style={secondaryBtnStyle}>닫기</button>
        </div>

        {isLoading && (
          <div style={{ padding: "40px 0", textAlign: "center", color: "#888" }}>로딩 중...</div>
        )}

        {!isLoading && items.length === 0 && (
          <div style={{ padding: "40px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
            스냅샷 데이터가 없습니다.
          </div>
        )}

        {!isLoading && items.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map((req: SnapshotReq) => (
              <div
                key={req.reqId}
                style={{
                  border:       "1px solid var(--color-border)",
                  borderRadius: 6,
                  overflow:     "hidden",
                }}
              >
                {/* 헤더 행 */}
                <div
                  style={{
                    display:      "flex",
                    alignItems:   "center",
                    padding:      "10px 14px",
                    cursor:       "pointer",
                    background:   "var(--color-bg-muted)",
                    gap:          10,
                  }}
                  onClick={() => setExpandedId((prev) => (prev === req.reqId ? null : req.reqId))}
                >
                  <span style={{ fontSize: 11, color: "#aaa", minWidth: 80 }}>{req.displayId}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{req.name}</span>
                  {req.priority && (
                    <span style={{
                      fontSize: 11, padding: "1px 6px", borderRadius: 4,
                      background: req.priority === "HIGH" ? "#ffebee" : req.priority === "MEDIUM" ? "#fff8e1" : "#e8f5e9",
                      color:      req.priority === "HIGH" ? "#c62828" : req.priority === "MEDIUM" ? "#f57f17" : "#2e7d32",
                    }}>
                      {req.priority === "HIGH" ? "높음" : req.priority === "MEDIUM" ? "중간" : "낮음"}
                    </span>
                  )}
                  <span style={{ fontSize: 13, color: "#888" }}>
                    {expandedId === req.reqId ? "▲" : "▼"}
                  </span>
                </div>

                {/* 상세 내용 펼침 */}
                {expandedId === req.reqId && (
                  <div style={{ padding: "14px 16px", borderTop: "1px solid var(--color-border)", fontSize: 13 }}>
                    {[
                      { label: "원문",      value: req.orgnlCn },
                      { label: "현행화",    value: req.curncyCn },
                      { label: "상세 명세", value: req.specCn },
                    ].map(({ label, value }) =>
                      value ? (
                        <div key={label} style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 4 }}>
                            {label}
                          </div>
                          <pre style={{ margin: 0, fontFamily: "inherit", whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--color-text-primary)", lineHeight: 1.6 }}>
                            {value}
                          </pre>
                        </div>
                      ) : null
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

const GRID_TEMPLATE = "50px 1fr 180px 200px 100px";

const gridHeaderStyle: React.CSSProperties = {
  display:             "grid",
  gridTemplateColumns: GRID_TEMPLATE,
  gap:                 12,
  padding:             "10px 16px",
  background:          "var(--color-bg-muted)",
  fontSize:            12,
  fontWeight:          600,
  color:               "var(--color-text-secondary)",
  borderBottom:        "1px solid var(--color-border)",
  alignItems:          "center",
};

const gridRowStyle: React.CSSProperties = {
  display:             "grid",
  gridTemplateColumns: GRID_TEMPLATE,
  gap:                 12,
  padding:             "12px 16px",
  alignItems:          "center",
  background:          "var(--color-bg-card)",
};

const linkBtnStyle: React.CSSProperties = {
  background:     "none",
  border:         "none",
  cursor:         "pointer",
  color:          "var(--color-primary, #1976d2)",
  fontSize:       14,
  fontWeight:     600,
  padding:        0,
  textAlign:      "left",
  textDecoration: "underline",
};

const primaryBtnStyle: React.CSSProperties = {
  padding:      "8px 20px",
  borderRadius: 6,
  border:       "none",
  background:   "var(--color-primary, #1976d2)",
  color:        "#fff",
  fontSize:     14,
  fontWeight:   600,
  cursor:       "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding:      "7px 16px",
  borderRadius: 6,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     13,
  cursor:       "pointer",
};

const inputStyle: React.CSSProperties = {
  width:        "100%",
  padding:      "8px 12px",
  borderRadius: 6,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     13,
  boxSizing:    "border-box",
};

const overlayStyle: React.CSSProperties = {
  position:       "fixed",
  inset:          0,
  background:     "rgba(0,0,0,0.45)",
  display:        "flex",
  alignItems:     "center",
  justifyContent: "center",
  zIndex:         1000,
};

const dialogStyle: React.CSSProperties = {
  background:   "var(--color-bg-card)",
  borderRadius: 10,
  padding:      "28px 32px",
  minWidth:     400,
  maxWidth:     560,
  width:        "100%",
  boxShadow:    "0 8px 32px rgba(0,0,0,0.18)",
};
