"use client";

/**
 * FunctionsPage — 기능 목록 (PID-00050)
 *
 * 역할:
 *   - 기능 목록 조회 (FID-00167)
 *   - 복잡도 인라인 편집 (FID-00168)
 *   - 공수 인라인 편집 (FID-00169)
 *   - 드래그앤드롭 순서 조정 (FID-00170)
 *   - 영역 상세 링크 이동 (AR-00077)
 *   - 기능 삭제 확인 팝업 (PID-00052 / FID-00179)
 *
 * 주요 기술:
 *   - TanStack Query: 목록 조회 및 낙관적 업데이트
 *   - useRef 기반 HTML5 네이티브 드래그앤드롭
 *   - 인라인 편집: 셀 클릭 → input/select 표시 → blur/Enter 저장
 */

import { Suspense, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type FuncRow = {
  funcId:        string;
  displayId:     string;
  name:          string;
  type:          string;
  status:        string;
  priority:      string;
  complexity:    string;
  effort:        string;
  sortOrder:     number;
  areaId:        string | null;
  areaName:      string;
  areaDisplayId: string | null;
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function FunctionsPage() {
  return (
    <Suspense fallback={null}>
      <FunctionsPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function FunctionsPageInner() {
  const params       = useParams<{ id: string }>();
  const router       = useRouter();
  const searchParams = useSearchParams();
  const queryClient  = useQueryClient();
  const projectId    = params.id;
  const areaIdFilter = searchParams.get("areaId") ?? undefined;

  const [deleteTarget,  setDeleteTarget]  = useState<FuncRow | null>(null);
  // 인라인 편집 상태: { funcId, field } or null
  const [editingCell, setEditingCell] = useState<{ funcId: string; field: "complexity" | "effort" } | null>(null);
  const [editValue,   setEditValue]   = useState("");

  const dragItem     = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  // ── 데이터 조회 ────────────────────────────────────────────────────────────
  const queryKey = areaIdFilter
    ? ["functions", projectId, areaIdFilter]
    : ["functions", projectId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => {
      const url = areaIdFilter
        ? `/api/projects/${projectId}/functions?areaId=${areaIdFilter}`
        : `/api/projects/${projectId}/functions`;
      return authFetch<{ data: { items: FuncRow[] } }>(url).then((r) => r.data);
    },
  });

  const items = data?.items ?? [];

  // ── 순서 변경 ──────────────────────────────────────────────────────────────
  const sortMutation = useMutation({
    mutationFn: (orders: { funcId: string; sortOrder: number }[]) =>
      authFetch(`/api/projects/${projectId}/functions/sort`, {
        method: "PUT",
        body:   JSON.stringify({ orders }),
      }),
    onError: () => {
      toast.error("순서 변경에 실패했습니다.");
      queryClient.invalidateQueries({ queryKey });
    },
  });

  function handleDragStart(idx: number) { dragItem.current = idx; }
  function handleDragEnter(idx: number) { dragOverItem.current = idx; }
  function handleDragEnd() {
    const from = dragItem.current;
    const to   = dragOverItem.current;
    if (from === null || to === null || from === to) return;
    const reordered = [...items];
    const [moved] = reordered.splice(from, 1);
    if (!moved) return;
    reordered.splice(to, 0, moved);
    queryClient.setQueryData(queryKey, { items: reordered });
    sortMutation.mutate(reordered.map((f, idx) => ({ funcId: f.funcId, sortOrder: idx + 1 })));
    dragItem.current = null;
    dragOverItem.current = null;
  }

  // ── 인라인 편집 뮤테이션 ──────────────────────────────────────────────────
  const inlineMutation = useMutation({
    mutationFn: ({ funcId, field, value }: { funcId: string; field: string; value: string }) =>
      authFetch(`/api/projects/${projectId}/functions/${funcId}/inline`, {
        method: "PATCH",
        body:   JSON.stringify({ field, value }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setEditingCell(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function startEdit(funcId: string, field: "complexity" | "effort", current: string) {
    setEditingCell({ funcId, field });
    setEditValue(current);
  }

  function commitEdit(funcId: string, field: "complexity" | "effort") {
    if (!editingCell) return;
    inlineMutation.mutate({ funcId, field, value: editValue });
  }

  // ── 로딩 ───────────────────────────────────────────────────────────────────
  if (isLoading) return <div style={{ padding: "40px 32px", color: "#888" }}>로딩 중...</div>;

  return (
    <div style={{ padding: "20px 24px" }}>
      {/* 헤더 타이틀 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text-primary)" }}>
            기능 정의 목록
          </div>
        </div>
        <button
          onClick={() => {
            const url = areaIdFilter
              ? `/projects/${projectId}/functions/new?areaId=${areaIdFilter}`
              : `/projects/${projectId}/functions/new`;
            router.push(url);
          }}
          style={primaryBtnStyle}
        >
          + 신규 등록
        </button>
      </div>

      {/* 총 건수 */}
      <div style={{ marginBottom: 16, fontSize: 14, color: "var(--color-text-secondary)" }}>
        총 {items.length}건
      </div>

      {items.length === 0 ? (
        <div style={{ padding: "60px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
          등록된 기능이 없습니다.
        </div>
      ) : (
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
          <div style={gridHeaderStyle}>
            <div />
            <div>영역명</div>
            <div>기능명</div>
            <div>유형</div>
            <div>복잡도</div>
            <div>공수</div>
            <div>상태</div>
            <div />
          </div>

          {items.map((fn, idx) => (
            <div
              key={fn.funcId}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragEnter={() => handleDragEnter(idx)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => e.preventDefault()}
              style={{
                ...gridRowStyle,
                borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
              }}
            >
              <div style={{ cursor: "grab", color: "#aaa", userSelect: "none", paddingLeft: 4 }}>☰</div>

              {/* 영역명 (클릭 → 영역 상세) */}
              <div>
                {fn.areaId ? (
                  <button
                    onClick={() => router.push(`/projects/${projectId}/areas/${fn.areaId}`)}
                    style={linkBtnStyle}
                  >
                    <span style={{ color: "var(--color-text-secondary)", fontSize: 12, marginRight: 4 }}>
                      {fn.areaDisplayId}
                    </span>
                    {fn.areaName}
                  </button>
                ) : (
                  <span style={{ color: "#aaa", fontSize: 13 }}>미분류</span>
                )}
              </div>

              {/* 기능명 (클릭 → 기능 상세) */}
              <div>
                <button
                  onClick={() => router.push(`/projects/${projectId}/functions/${fn.funcId}`)}
                  style={linkBtnStyle}
                >
                  <span style={{ color: "var(--color-text-secondary)", fontSize: 12, marginRight: 4 }}>
                    {fn.displayId}
                  </span>
                  {fn.name}
                </button>
              </div>

              {/* 유형 배지 */}
              <div>
                <span style={typeBadgeStyle(fn.type)}>{fn.type}</span>
              </div>

              {/* 복잡도 인라인 편집 (FID-00168) */}
              <div>
                {editingCell?.funcId === fn.funcId && editingCell.field === "complexity" ? (
                  <select
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => commitEdit(fn.funcId, "complexity")}
                    style={{ fontSize: 12, padding: "2px 4px", borderRadius: 4, border: "1px solid var(--color-border)" }}
                  >
                    <option value="HIGH">HIGH</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="LOW">LOW</option>
                  </select>
                ) : (
                  <span
                    onClick={() => startEdit(fn.funcId, "complexity", fn.complexity)}
                    style={{ ...complexityBadgeStyle(fn.complexity), cursor: "pointer" }}
                    title="클릭하여 편집"
                  >
                    {fn.complexity}
                  </span>
                )}
              </div>

              {/* 공수 인라인 편집 (FID-00169) */}
              <div>
                {editingCell?.funcId === fn.funcId && editingCell.field === "effort" ? (
                  <input
                    autoFocus
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => commitEdit(fn.funcId, "effort")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit(fn.funcId, "effort");
                      if (e.key === "Escape") setEditingCell(null);
                    }}
                    placeholder="예: 2h"
                    style={{ width: 60, fontSize: 12, padding: "2px 4px", borderRadius: 4, border: "1px solid var(--color-border)" }}
                  />
                ) : (
                  <span
                    onClick={() => startEdit(fn.funcId, "effort", fn.effort)}
                    style={{ fontSize: 13, cursor: "pointer", color: fn.effort ? "var(--color-text-primary)" : "#aaa" }}
                    title="클릭하여 편집"
                  >
                    {fn.effort || "-"}
                  </span>
                )}
              </div>

              {/* 상태 배지 */}
              <div>
                <span style={statusBadgeStyle(fn.status)}>
                  {STATUS_LABELS[fn.status] ?? fn.status}
                </span>
              </div>

              {/* 액션 버튼 */}
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  onClick={() => router.push(`/projects/${projectId}/functions/${fn.funcId}`)}
                  title="기능 상세"
                  style={{
                    background: "none", border: "1px solid var(--color-border)",
                    borderRadius: 4, cursor: "pointer", fontSize: 13, padding: "3px 8px",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  →
                </button>
                <button onClick={() => setDeleteTarget(fn)} style={dangerBtnStyle}>
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PID-00052 삭제 확인 팝업 */}
      {deleteTarget && (
        <DeleteConfirmDialog
          func={deleteTarget}
          projectId={projectId}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            queryClient.invalidateQueries({ queryKey });
          }}
        />
      )}
    </div>
  );
}

// ── PID-00052 삭제 확인 다이얼로그 ───────────────────────────────────────────

function DeleteConfirmDialog({
  func, projectId, onClose, onDeleted,
}: {
  func:      FuncRow;
  projectId: string;
  onClose:   () => void;
  onDeleted: () => void;
}) {
  const deleteMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/functions/${func.funcId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("기능이 삭제되었습니다.");
      onDeleted();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>
          기능을 삭제하시겠습니까?
        </h3>
        <p style={{ margin: "0 0 12px", fontSize: 14, color: "var(--color-text-secondary)" }}>
          &lsquo;{func.name}&rsquo;
        </p>
        <p style={{ margin: "0 0 24px", fontSize: 13, color: "#e53935" }}>
          연결된 AI 태스크·이력이 함께 삭제되며 복구할 수 없습니다.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={secondaryBtnStyle} disabled={deleteMutation.isPending}>
            취소
          </button>
          <button
            onClick={() => deleteMutation.mutate()}
            style={{ ...primaryBtnStyle, background: "#e53935" }}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? "삭제 중..." : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 상수·스타일 ───────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  NONE:        "미착수",
  DESIGN_DONE: "설계완료",
  IMPL_DONE:   "구현완료",
};

function typeBadgeStyle(type: string): React.CSSProperties {
  return {
    display: "inline-block", padding: "2px 6px", borderRadius: 4,
    fontSize: 11, fontWeight: 600, background: "#e3f2fd", color: "#1565c0",
  };
}

function complexityBadgeStyle(c: string): React.CSSProperties {
  const map: Record<string, { bg: string; color: string }> = {
    HIGH:   { bg: "#fce4ec", color: "#880e4f" },
    MEDIUM: { bg: "#fff3e0", color: "#e65100" },
    LOW:    { bg: "#e8f5e9", color: "#2e7d32" },
  };
  const s = map[c] ?? { bg: "#f5f5f5", color: "#555" };
  return { display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, ...s };
}

function statusBadgeStyle(status: string): React.CSSProperties {
  const map: Record<string, { bg: string; color: string }> = {
    NONE:        { bg: "#f5f5f5",  color: "#555" },
    DESIGN_DONE: { bg: "#e3f2fd", color: "#1565c0" },
    IMPL_DONE:   { bg: "#e8f5e9", color: "#2e7d32" },
  };
  const s = map[status] ?? { bg: "#f5f5f5", color: "#555" };
  return { display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, ...s };
}

const GRID_TEMPLATE = "32px minmax(100px,160px) 1fr 80px 90px 70px 90px 100px";

const gridHeaderStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: GRID_TEMPLATE, gap: 8,
  padding: "10px 16px", background: "var(--color-bg-muted)",
  fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)",
  borderBottom: "1px solid var(--color-border)", alignItems: "center",
};
const gridRowStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: GRID_TEMPLATE, gap: 8,
  padding: "10px 16px", alignItems: "center",
  background: "var(--color-bg-card)", transition: "background 0.1s",
};
const linkBtnStyle: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  color: "var(--color-primary, #1976d2)", fontSize: 13,
  padding: 0, textAlign: "left", textDecoration: "underline",
};
const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px", borderRadius: 6, border: "none",
  background: "var(--color-primary, #1976d2)", color: "#fff",
  fontSize: 14, fontWeight: 600, cursor: "pointer",
};
const secondaryBtnStyle: React.CSSProperties = {
  padding: "8px 16px", borderRadius: 6,
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-primary)", fontSize: 14, cursor: "pointer",
};
const dangerBtnStyle: React.CSSProperties = {
  padding: "4px 12px", borderRadius: 4,
  border: "1px solid #e53935", background: "transparent",
  color: "#e53935", fontSize: 12, cursor: "pointer",
};
const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
};
const dialogStyle: React.CSSProperties = {
  background: "var(--color-bg-card)", borderRadius: 10,
  padding: "28px 32px", minWidth: 380, maxWidth: 480,
  boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
};
