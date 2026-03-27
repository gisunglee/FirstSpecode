"use client";

/**
 * RequirementsPage — 요구사항 목록 (PID-00030)
 *
 * 역할:
 *   - 요구사항 목록 조회 (FID-00099)
 *   - 드래그앤드롭 순서 조정 (FID-00101)
 *   - 요구사항 삭제 확인 팝업 (PID-00032 / FID-00109)
 *   - 과업 상세 링크 이동 (FID-00100)
 */

import { Suspense, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type RequirementRow = {
  requirementId: string;
  displayId:     string;
  name:          string;
  priority:      string;
  source:        string;
  taskId:        string | null;
  taskName:      string;
  unitWorkCount: number;
  sortOrder:     number;
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function RequirementsPage() {
  return (
    <Suspense fallback={null}>
      <RequirementsPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function RequirementsPageInner() {
  const params      = useParams<{ id: string }>();
  const router      = useRouter();
  const queryClient = useQueryClient();
  const projectId   = params.id;

  // 삭제 다이얼로그 상태
  const [deleteTarget, setDeleteTarget] = useState<RequirementRow | null>(null);

  // ── 드래그 상태 ────────────────────────────────────────────────────────────
  const dragItem     = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  // ── 데이터 조회 ────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ["requirements", projectId],
    queryFn:  () =>
      authFetch<{ data: { items: RequirementRow[]; totalCount: number } }>(
        `/api/projects/${projectId}/requirements`
      ).then((r) => r.data),
  });

  const items = data?.items ?? [];

  // ── 순서 변경 뮤테이션 ──────────────────────────────────────────────────────
  const sortMutation = useMutation({
    mutationFn: (orders: { requirementId: string; sortOrder: number }[]) =>
      authFetch(`/api/projects/${projectId}/requirements/sort`, {
        method: "PUT",
        body:   JSON.stringify({ orders }),
      }),
    onError: () => {
      toast.error("순서 변경에 실패했습니다.");
      queryClient.invalidateQueries({ queryKey: ["requirements", projectId] });
    },
  });

  // ── 드래그 핸들러 ──────────────────────────────────────────────────────────
  function handleDragStart(index: number) {
    dragItem.current = index;
  }

  function handleDragEnter(index: number) {
    dragOverItem.current = index;
  }

  function handleDragEnd() {
    const from = dragItem.current;
    const to   = dragOverItem.current;
    if (from === null || to === null || from === to) return;

    const reordered = [...items];
    const [moved]   = reordered.splice(from, 1);
    if (!moved) return;
    reordered.splice(to, 0, moved);

    // 낙관적 업데이트 후 서버 동기화
    queryClient.setQueryData(
      ["requirements", projectId],
      { items: reordered, totalCount: reordered.length }
    );

    const orders = reordered.map((r, idx) => ({
      requirementId: r.requirementId,
      sortOrder:     idx + 1,
    }));
    sortMutation.mutate(orders);

    dragItem.current     = null;
    dragOverItem.current = null;
  }

  // ── 로딩 ───────────────────────────────────────────────────────────────────
  if (isLoading) {
    return <div style={{ padding: "40px 32px", color: "#888" }}>로딩 중...</div>;
  }

  return (
    <div style={{ padding: "20px 24px" }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text-primary)" }}>
            요구사항 목록
          </div>
        </div>
        <button
          onClick={() => router.push(`/projects/${projectId}/requirements/new`)}
          style={primaryBtnStyle}
        >
          + 신규 등록
        </button>
      </div>

      {/* 총 건수 */}
      <div style={{ marginBottom: 16, fontSize: 14, color: "var(--color-text-secondary)" }}>
        총 {items.length}건
      </div>

      {/* 목록 */}
      {items.length === 0 ? (
        <div style={{ padding: "60px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
          등록된 요구사항이 없습니다.
        </div>
      ) : (
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
          {/* 헤더 행 */}
          <div style={gridHeaderStyle}>
            <div />
            <div>과업명</div>
            <div>요구사항명</div>
            <div>우선순위</div>
            <div>출처</div>
            <div style={{ textAlign: "center" }}>단위업무</div>
            <div />
          </div>

          {/* 데이터 행 */}
          {items.map((req, idx) => (
            <div
              key={req.requirementId}
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
              {/* 드래그 핸들 */}
              <div style={{ cursor: "grab", color: "#aaa", userSelect: "none", paddingLeft: 4 }}>
                ☰
              </div>

              {/* 과업명 (클릭 → 과업 상세) */}
              <div>
                {req.taskId ? (
                  <button
                    onClick={() => router.push(`/projects/${projectId}/tasks/${req.taskId}`)}
                    style={linkBtnStyle}
                  >
                    {req.taskName}
                  </button>
                ) : (
                  <span style={{ color: "#aaa", fontSize: 13 }}>미분류</span>
                )}
              </div>

              {/* 요구사항명 (클릭 → 상세) */}
              <div>
                <button
                  onClick={() => router.push(`/projects/${projectId}/requirements/${req.requirementId}`)}
                  style={linkBtnStyle}
                >
                  <span style={{ color: "var(--color-text-secondary)", fontSize: 12, marginRight: 6 }}>
                    {req.displayId}
                  </span>
                  {req.name}
                </button>
              </div>

              {/* 우선순위 배지 */}
              <div>
                <span style={priorityBadgeStyle(req.priority)}>
                  {PRIORITY_LABELS[req.priority] ?? req.priority}
                </span>
              </div>

              {/* 출처 배지 */}
              <div>
                <span style={sourceBadgeStyle(req.source)}>
                  {SOURCE_LABELS[req.source] ?? req.source}
                </span>
              </div>

              {/* 단위업무 수 */}
              <div style={{ textAlign: "center", fontSize: 13, color: "var(--color-text-secondary)" }}>
                {req.unitWorkCount}
              </div>

              {/* 삭제 버튼 */}
              <div>
                <button
                  onClick={() => setDeleteTarget(req)}
                  style={dangerBtnStyle}
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PID-00032 삭제 확인 팝업 */}
      {deleteTarget && (
        <DeleteConfirmDialog
          requirement={deleteTarget}
          projectId={projectId}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            queryClient.invalidateQueries({ queryKey: ["requirements", projectId] });
          }}
        />
      )}
    </div>
  );
}

// ── PID-00032 삭제 확인 다이얼로그 ───────────────────────────────────────────

function DeleteConfirmDialog({
  requirement, projectId, onClose, onDeleted,
}: {
  requirement: RequirementRow;
  projectId:   string;
  onClose:     () => void;
  onDeleted:   () => void;
}) {
  const [deleteChildren, setDeleteChildren] = useState<boolean | null>(null);

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (deleteChildren === null) {
        throw new Error("하위 데이터 처리 방법을 선택해 주세요.");
      }
      return authFetch(
        `/api/projects/${projectId}/requirements/${requirement.requirementId}?deleteChildren=${deleteChildren}`,
        { method: "DELETE" }
      );
    },
    onSuccess: () => {
      toast.success("요구사항이 삭제되었습니다.");
      onDeleted();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleDelete() {
    if (deleteChildren === null) {
      toast.error("하위 데이터 처리 방법을 선택해 주세요.");
      return;
    }
    deleteMutation.mutate();
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>
          요구사항을 삭제하시겠습니까?
        </h3>
        <p style={{ margin: "0 0 20px", fontSize: 14, color: "var(--color-text-secondary)" }}>
          &lsquo;{requirement.name}&rsquo;
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
            <input
              type="radio"
              name="deleteType"
              checked={deleteChildren === true}
              onChange={() => setDeleteChildren(true)}
            />
            하위 사용자스토리 전체 삭제
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
            <input
              type="radio"
              name="deleteType"
              checked={deleteChildren === false}
              onChange={() => setDeleteChildren(false)}
            />
            요구사항만 삭제 (스토리 미분류 처리)
          </label>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={secondaryBtnStyle} disabled={deleteMutation.isPending}>
            취소
          </button>
          <button
            onClick={handleDelete}
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

// ── 상수 ─────────────────────────────────────────────────────────────────────

const PRIORITY_LABELS: Record<string, string> = {
  HIGH:   "높음",
  MEDIUM: "중간",
  LOW:    "낮음",
};

const SOURCE_LABELS: Record<string, string> = {
  RFP:    "RFP",
  ADD:    "추가",
  CHANGE: "변경",
};

// ── 스타일 헬퍼 ──────────────────────────────────────────────────────────────

function priorityBadgeStyle(priority: string): React.CSSProperties {
  const colors: Record<string, { bg: string; color: string }> = {
    HIGH:   { bg: "#fdecea", color: "#c62828" },
    MEDIUM: { bg: "#fff8e1", color: "#e65100" },
    LOW:    { bg: "#e8f5e9", color: "#2e7d32" },
  };
  const c = colors[priority] ?? { bg: "#f5f5f5", color: "#555" };
  return {
    display:      "inline-block",
    padding:      "2px 8px",
    borderRadius: 4,
    fontSize:     12,
    fontWeight:   600,
    background:   c.bg,
    color:        c.color,
  };
}

function sourceBadgeStyle(source: string): React.CSSProperties {
  const colors: Record<string, { bg: string; color: string }> = {
    RFP:    { bg: "#e3f2fd", color: "#1565c0" },
    ADD:    { bg: "#e8f5e9", color: "#2e7d32" },
    CHANGE: { bg: "#fff3e0", color: "#e65100" },
  };
  const c = colors[source] ?? { bg: "#f5f5f5", color: "#555" };
  return {
    display:      "inline-block",
    padding:      "2px 8px",
    borderRadius: 4,
    fontSize:     12,
    fontWeight:   600,
    background:   c.bg,
    color:        c.color,
  };
}

// ── 스타일 상수 ──────────────────────────────────────────────────────────────

const GRID_TEMPLATE = "32px minmax(120px, 200px) 1fr 90px 80px 80px 60px";

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
  transition:          "background 0.1s",
};

const linkBtnStyle: React.CSSProperties = {
  background:  "none",
  border:      "none",
  cursor:      "pointer",
  color:       "var(--color-primary, #1976d2)",
  fontSize:    14,
  padding:     0,
  textAlign:   "left",
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
  padding:      "8px 16px",
  borderRadius: 6,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     14,
  cursor:       "pointer",
};

const dangerBtnStyle: React.CSSProperties = {
  padding:      "4px 12px",
  borderRadius: 4,
  border:       "1px solid #e53935",
  background:   "transparent",
  color:        "#e53935",
  fontSize:     12,
  cursor:       "pointer",
};

const overlayStyle: React.CSSProperties = {
  position:        "fixed",
  inset:           0,
  background:      "rgba(0,0,0,0.45)",
  display:         "flex",
  alignItems:      "center",
  justifyContent:  "center",
  zIndex:          1000,
};

const dialogStyle: React.CSSProperties = {
  background:   "var(--color-bg-card)",
  borderRadius: 10,
  padding:      "28px 32px",
  minWidth:     380,
  maxWidth:     480,
  boxShadow:    "0 8px 32px rgba(0,0,0,0.18)",
};
