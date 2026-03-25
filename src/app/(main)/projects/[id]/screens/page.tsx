"use client";

/**
 * ScreensPage — 화면 목록 (PID-00043)
 *
 * 역할:
 *   - 화면 목록 조회 (FID-00142)
 *   - 드래그앤드롭 순서 조정 (FID-00145)
 *   - 단위업무 상세 링크 이동 (FID-00144)
 *   - 영역 목록 바로가기 (FID-00143)
 *   - 화면 삭제 확인 팝업 (PID-00045 / FID-00150)
 *
 * 주요 기술:
 *   - TanStack Query: 목록 조회 및 낙관적 업데이트
 *   - useRef 기반 HTML5 네이티브 드래그앤드롭
 */

import { Suspense, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type ScreenRow = {
  screenId:     string;
  displayId:    string;
  name:         string;
  type:         string;
  categoryL:    string;
  unitWorkId:   string | null;
  unitWorkName: string;
  areaCount:    number;
  sortOrder:    number;
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function ScreensPage() {
  return (
    <Suspense fallback={null}>
      <ScreensPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function ScreensPageInner() {
  const params      = useParams<{ id: string }>();
  const router      = useRouter();
  const queryClient = useQueryClient();
  const projectId   = params.id;

  // 삭제 다이얼로그 상태
  const [deleteTarget, setDeleteTarget] = useState<ScreenRow | null>(null);

  // ── 드래그 상태 ────────────────────────────────────────────────────────────
  const dragItem     = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  // ── 데이터 조회 ────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ["screens", projectId],
    queryFn:  () =>
      authFetch<{ data: { items: ScreenRow[]; totalCount: number } }>(
        `/api/projects/${projectId}/screens`
      ).then((r) => r.data),
  });

  const items = data?.items ?? [];

  // ── 순서 변경 뮤테이션 ──────────────────────────────────────────────────────
  const sortMutation = useMutation({
    mutationFn: (orders: { screenId: string; sortOrder: number }[]) =>
      authFetch(`/api/projects/${projectId}/screens/sort`, {
        method: "PUT",
        body:   JSON.stringify({ orders }),
      }),
    onError: () => {
      toast.error("순서 변경에 실패했습니다.");
      queryClient.invalidateQueries({ queryKey: ["screens", projectId] });
    },
  });

  // ── 드래그 핸들러 ──────────────────────────────────────────────────────────
  function handleDragStart(index: number) { dragItem.current = index; }
  function handleDragEnter(index: number) { dragOverItem.current = index; }

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
      ["screens", projectId],
      { items: reordered, totalCount: reordered.length }
    );

    const orders = reordered.map((s, idx) => ({ screenId: s.screenId, sortOrder: idx + 1 }));
    sortMutation.mutate(orders);

    dragItem.current     = null;
    dragOverItem.current = null;
  }

  // ── 로딩 ───────────────────────────────────────────────────────────────────
  if (isLoading) {
    return <div style={{ padding: "40px 32px", color: "#888" }}>로딩 중...</div>;
  }

  return (
    <div style={{ padding: "32px" }}>
      {/* 헤더 타이틀 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text-primary)" }}>
            화면 설계 목록
          </div>
        </div>
        <button
          onClick={() => router.push(`/projects/${projectId}/screens/new`)}
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
          등록된 화면이 없습니다.
        </div>
      ) : (
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
          {/* 헤더 행 */}
          <div style={gridHeaderStyle}>
            <div />
            <div>단위업무</div>
            <div>화면명</div>
            <div>유형</div>
            <div>대분류</div>
            <div style={{ textAlign: "center" }}>영역수</div>
            <div />
          </div>

          {/* 데이터 행 */}
          {items.map((screen, idx) => (
            <div
              key={screen.screenId}
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
              <div style={{ cursor: "grab", color: "#aaa", userSelect: "none", paddingLeft: 4 }}>☰</div>

              {/* 단위업무명 (클릭 → 단위업무 상세, FID-00144) */}
              <div>
                {screen.unitWorkId ? (
                  <button
                    onClick={() => router.push(`/projects/${projectId}/unit-works/${screen.unitWorkId}`)}
                    style={linkBtnStyle}
                  >
                    {screen.unitWorkName}
                  </button>
                ) : (
                  <span style={{ color: "#aaa", fontSize: 13 }}>미분류</span>
                )}
              </div>

              {/* 화면명 (클릭 → 화면 상세·편집) */}
              <div>
                <button
                  onClick={() => router.push(`/projects/${projectId}/screens/${screen.screenId}`)}
                  style={linkBtnStyle}
                >
                  <span style={{ color: "var(--color-text-secondary)", fontSize: 12, marginRight: 6 }}>
                    {screen.displayId}
                  </span>
                  {screen.name}
                </button>
              </div>

              {/* 유형 배지 */}
              <div>
                <span style={typeBadgeStyle(screen.type)}>
                  {screen.type}
                </span>
              </div>

              {/* 대분류 */}
              <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                {screen.categoryL || "-"}
              </div>

              {/* 영역 수 */}
              <div style={{ textAlign: "center", fontSize: 13, color: "var(--color-text-secondary)" }}>
                {screen.areaCount}
              </div>

              {/* 바로가기(→) + 삭제 (FID-00143) */}
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  onClick={() => router.push(`/projects/${projectId}/areas?screenId=${screen.screenId}`)}
                  title="영역 목록으로 이동"
                  style={{
                    background:   "none",
                    border:       "1px solid var(--color-border)",
                    borderRadius: 4,
                    cursor:       "pointer",
                    fontSize:     13,
                    padding:      "3px 8px",
                    color:        "var(--color-text-secondary)",
                  }}
                >
                  →
                </button>
                <button
                  onClick={() => setDeleteTarget(screen)}
                  style={dangerBtnStyle}
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PID-00045 삭제 확인 팝업 */}
      {deleteTarget && (
        <DeleteConfirmDialog
          screen={deleteTarget}
          projectId={projectId}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            queryClient.invalidateQueries({ queryKey: ["screens", projectId] });
          }}
        />
      )}
    </div>
  );
}

// ── PID-00045 삭제 확인 다이얼로그 ───────────────────────────────────────────

function DeleteConfirmDialog({
  screen, projectId, onClose, onDeleted,
}: {
  screen:    ScreenRow;
  projectId: string;
  onClose:   () => void;
  onDeleted: () => void;
}) {
  const hasAreas = screen.areaCount > 0;
  const [deleteChildren, setDeleteChildren] = useState<boolean | null>(hasAreas ? null : true);

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (hasAreas && deleteChildren === null) {
        throw new Error("하위 데이터 처리 방법을 선택해 주세요.");
      }
      return authFetch(
        `/api/projects/${projectId}/screens/${screen.screenId}?deleteChildren=${deleteChildren ?? true}`,
        { method: "DELETE" }
      );
    },
    onSuccess: () => {
      toast.success("화면이 삭제되었습니다.");
      onDeleted();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleDelete() {
    if (hasAreas && deleteChildren === null) {
      toast.error("하위 데이터 처리 방법을 선택해 주세요.");
      return;
    }
    deleteMutation.mutate();
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>
          화면을 삭제하시겠습니까?
        </h3>
        <p style={{ margin: "0 0 20px", fontSize: 14, color: "var(--color-text-secondary)" }}>
          &lsquo;{screen.name}&rsquo;
        </p>

        {hasAreas && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
            <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--color-text-secondary)" }}>
              연결된 영역 {screen.areaCount}개 처리 방법:
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
              <input
                type="radio"
                name="deleteType"
                checked={deleteChildren === true}
                onChange={() => setDeleteChildren(true)}
              />
              하위 영역·기능 전체 삭제
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
              <input
                type="radio"
                name="deleteType"
                checked={deleteChildren === false}
                onChange={() => setDeleteChildren(false)}
              />
              화면만 삭제 (영역 미분류 상태로 유지)
            </label>
          </div>
        )}

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

function typeBadgeStyle(type: string): React.CSSProperties {
  const colors: Record<string, { bg: string; color: string }> = {
    LIST:        { bg: "#e3f2fd", color: "#1565c0" },
    DETAIL:      { bg: "#e8f5e9", color: "#2e7d32" },
    INPUT:       { bg: "#fff3e0", color: "#e65100" },
    POPUP:       { bg: "#f3e5f5", color: "#6a1b9a" },
    TAB:         { bg: "#e0f2f1", color: "#00695c" },
    REPORT:      { bg: "#fce4ec", color: "#880e4f" },
  };
  const c = colors[type] ?? { bg: "#f5f5f5", color: "#555" };
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

// ── 스타일 ────────────────────────────────────────────────────────────────────

const GRID_TEMPLATE = "32px minmax(120px, 200px) 1fr 80px 100px 70px 100px";

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
  background:     "none",
  border:         "none",
  cursor:         "pointer",
  color:          "var(--color-primary, #1976d2)",
  fontSize:       14,
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
  minWidth:     380,
  maxWidth:     480,
  boxShadow:    "0 8px 32px rgba(0,0,0,0.18)",
};
