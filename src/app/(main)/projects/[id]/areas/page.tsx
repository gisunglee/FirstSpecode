"use client";

/**
 * AreasPage — 영역 목록 (PID-00046)
 *
 * 역할:
 *   - 영역 목록 조회 (FID-00151)
 *   - 드래그앤드롭 순서 조정 (FID-00152)
 *   - 화면 상세 링크 이동 (FID-00151 화면명 클릭)
 *   - 기능 목록 바로가기 (FID-00151)
 *   - 영역 삭제 확인 팝업 (PID-00049 / FID-00166)
 *
 * 주요 기술:
 *   - TanStack Query: 목록 조회 및 낙관적 업데이트
 *   - useRef 기반 HTML5 네이티브 드래그앤드롭
 */

import { Suspense, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type AreaRow = {
  areaId:          string;
  displayId:       string;
  name:            string;
  type:            string;
  sortOrder:       number;
  screenId:        string | null;
  screenName:      string;
  screenDisplayId: string | null;
  functionCount:   number;
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function AreasPage() {
  return (
    <Suspense fallback={null}>
      <AreasPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function AreasPageInner() {
  const params       = useParams<{ id: string }>();
  const router       = useRouter();
  const searchParams = useSearchParams();
  const queryClient  = useQueryClient();
  const projectId    = params.id;

  // URL에 screenId 파라미터가 있으면 해당 화면 기준으로 필터
  const screenIdFilter = searchParams.get("screenId") ?? undefined;

  // 삭제 다이얼로그 상태
  const [deleteTarget, setDeleteTarget] = useState<AreaRow | null>(null);

  // ── 드래그 상태 ────────────────────────────────────────────────────────────
  const dragItem     = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  // ── 데이터 조회 ────────────────────────────────────────────────────────────
  const queryKey = screenIdFilter
    ? ["areas", projectId, screenIdFilter]
    : ["areas", projectId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => {
      const url = screenIdFilter
        ? `/api/projects/${projectId}/areas?screenId=${screenIdFilter}`
        : `/api/projects/${projectId}/areas`;
      return authFetch<{ data: { items: AreaRow[]; totalCount: number } }>(url)
        .then((r) => r.data);
    },
  });

  const items = data?.items ?? [];

  // ── 순서 변경 뮤테이션 ──────────────────────────────────────────────────────
  const sortMutation = useMutation({
    mutationFn: (orders: { areaId: string; sortOrder: number }[]) =>
      authFetch(`/api/projects/${projectId}/areas/sort`, {
        method: "PUT",
        body:   JSON.stringify({ orders }),
      }),
    onError: () => {
      toast.error("순서 변경에 실패했습니다.");
      queryClient.invalidateQueries({ queryKey });
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
    queryClient.setQueryData(queryKey, { items: reordered, totalCount: reordered.length });

    const orders = reordered.map((a, idx) => ({ areaId: a.areaId, sortOrder: idx + 1 }));
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
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 4 }}>
            영역 목록
          </div>
          <span style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
            총 {items.length}건
            {screenIdFilter && (
              <span style={{ marginLeft: 8, color: "var(--color-primary, #1976d2)", fontSize: 12 }}>
                (화면 필터 적용)
              </span>
            )}
          </span>
        </div>
        <button
          onClick={() => {
            const url = screenIdFilter
              ? `/projects/${projectId}/areas/new?screenId=${screenIdFilter}`
              : `/projects/${projectId}/areas/new`;
            router.push(url);
          }}
          style={primaryBtnStyle}
        >
          + 신규 등록
        </button>
      </div>

      {/* 목록 */}
      {items.length === 0 ? (
        <div style={{ padding: "60px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
          등록된 영역이 없습니다.
        </div>
      ) : (
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
          {/* 헤더 행 */}
          <div style={gridHeaderStyle}>
            <div />
            <div>화면명</div>
            <div>영역명</div>
            <div>유형</div>
            <div style={{ textAlign: "center" }}>기능수</div>
            <div />
          </div>

          {/* 데이터 행 */}
          {items.map((area, idx) => (
            <div
              key={area.areaId}
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

              {/* 화면명 (클릭 → 화면 상세·편집) */}
              <div>
                {area.screenId ? (
                  <button
                    onClick={() => router.push(`/projects/${projectId}/screens/${area.screenId}`)}
                    style={linkBtnStyle}
                  >
                    <span style={{ color: "var(--color-text-secondary)", fontSize: 12, marginRight: 6 }}>
                      {area.screenDisplayId}
                    </span>
                    {area.screenName}
                  </button>
                ) : (
                  <span style={{ color: "#aaa", fontSize: 13 }}>미분류</span>
                )}
              </div>

              {/* 영역명 (클릭 → 영역 상세·편집) */}
              <div>
                <button
                  onClick={() => router.push(`/projects/${projectId}/areas/${area.areaId}`)}
                  style={linkBtnStyle}
                >
                  <span style={{ color: "var(--color-text-secondary)", fontSize: 12, marginRight: 6 }}>
                    {area.displayId}
                  </span>
                  {area.name}
                </button>
              </div>

              {/* 유형 배지 */}
              <div>
                <span style={typeBadgeStyle(area.type)}>
                  {area.type}
                </span>
              </div>

              {/* 기능 수 */}
              <div style={{ textAlign: "center", fontSize: 13, color: "var(--color-text-secondary)" }}>
                {area.functionCount}
              </div>

              {/* 바로가기(→) + 삭제 */}
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  onClick={() => router.push(`/projects/${projectId}/functions?areaId=${area.areaId}`)}
                  title="기능 목록으로 이동"
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
                  onClick={() => setDeleteTarget(area)}
                  style={dangerBtnStyle}
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PID-00049 삭제 확인 팝업 */}
      {deleteTarget && (
        <DeleteConfirmDialog
          area={deleteTarget}
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

// ── PID-00049 삭제 확인 다이얼로그 ───────────────────────────────────────────

function DeleteConfirmDialog({
  area, projectId, onClose, onDeleted,
}: {
  area:      AreaRow;
  projectId: string;
  onClose:   () => void;
  onDeleted: () => void;
}) {
  const hasFunctions = area.functionCount > 0;
  const [deleteChildren, setDeleteChildren] = useState<boolean | null>(hasFunctions ? null : true);

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (hasFunctions && deleteChildren === null) {
        throw new Error("하위 데이터 처리 방법을 선택해 주세요.");
      }
      return authFetch(
        `/api/projects/${projectId}/areas/${area.areaId}?deleteChildren=${deleteChildren ?? true}`,
        { method: "DELETE" }
      );
    },
    onSuccess: () => {
      toast.success("영역이 삭제되었습니다.");
      onDeleted();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleDelete() {
    if (hasFunctions && deleteChildren === null) {
      toast.error("하위 데이터 처리 방법을 선택해 주세요.");
      return;
    }
    deleteMutation.mutate();
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>
          영역을 삭제하시겠습니까?
        </h3>
        <p style={{ margin: "0 0 20px", fontSize: 14, color: "var(--color-text-secondary)" }}>
          &lsquo;{area.name}&rsquo;
        </p>

        {hasFunctions && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
            <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--color-text-secondary)" }}>
              연결된 기능 {area.functionCount}개 처리 방법:
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
              <input
                type="radio"
                name="deleteType"
                checked={deleteChildren === true}
                onChange={() => setDeleteChildren(true)}
              />
              하위 기능 전체 삭제
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
              <input
                type="radio"
                name="deleteType"
                checked={deleteChildren === false}
                onChange={() => setDeleteChildren(false)}
              />
              영역만 삭제 (기능 미분류 상태로 유지)
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
    SEARCH:      { bg: "#e3f2fd", color: "#1565c0" },
    GRID:        { bg: "#e8f5e9", color: "#2e7d32" },
    FORM:        { bg: "#fff3e0", color: "#e65100" },
    INFO_CARD:   { bg: "#f3e5f5", color: "#6a1b9a" },
    TAB:         { bg: "#e0f2f1", color: "#00695c" },
    FULL_SCREEN: { bg: "#fce4ec", color: "#880e4f" },
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

const GRID_TEMPLATE = "32px minmax(120px, 200px) 1fr 100px 70px 100px";

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
