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
  funcId:          string;
  displayId:       string;
  name:            string;
  type:            string;
  status:          string;
  priority:        string;
  complexity:      string;
  effort:          string;
  sortOrder:       number;
  areaId:          string | null;
  areaName:        string;
  areaDisplayId:   string | null;
  areaSortOrder:   number;
  screenId:        string | null;
  screenName:      string;
  screenDisplayId: string | null;
  unitWorkId:      string | null;
  unitWorkName:    string;
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
  // 정렬순서 직접 입력 상태: { funcId → sortOrder }
  const [sortEdits, setSortEdits] = useState<Record<string, number>>({});

  // 검색 필터
  const [unitWorkFilter, setUnitWorkFilter] = useState("");
  const [screenFilter,   setScreenFilter]   = useState("");

  function handleUnitWorkChange(val: string) {
    setUnitWorkFilter(val);
    setScreenFilter(""); // 단위업무 바뀌면 화면 필터 초기화
  }

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

  // 단위업무 셀렉트 옵션 (중복 제거)
  const unitWorkOptions = Array.from(
    new Map(items.filter((f) => f.unitWorkId).map((f) => [f.unitWorkId, f.unitWorkName])).entries()
  ).map(([id, name]) => ({ id: id!, name }));

  // 화면 셀렉트 옵션 — 선택된 단위업무 기준으로 좁힘
  const screenOptions = Array.from(
    new Map(
      items
        .filter((f) => f.screenId && (!unitWorkFilter || f.unitWorkId === unitWorkFilter))
        .map((f) => [f.screenId, `${f.screenDisplayId ?? ""} ${f.screenName}`.trim()])
    ).entries()
  ).map(([id, name]) => ({ id: id!, name }));

  // 클라이언트 필터링
  const filteredItems = items.filter(
    (f) =>
      (!unitWorkFilter || f.unitWorkId === unitWorkFilter) &&
      (!screenFilter   || f.screenId   === screenFilter)
  );

  // ── 순서 변경 ──────────────────────────────────────────────────────────────
  const sortMutation = useMutation({
    mutationFn: (orders: { funcId: string; sortOrder: number }[]) =>
      authFetch(`/api/projects/${projectId}/functions/sort`, {
        method: "PUT",
        body:   JSON.stringify({ orders }),
      }),
    onSuccess: () => {
      setSortEdits({});
      queryClient.invalidateQueries({ queryKey });
    },
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
    dragItem.current = null;
    dragOverItem.current = null;
    if (from === null || to === null || from === to) return;

    // 영역이 다르면 이동 불가
    if (filteredItems[from]?.areaId !== filteredItems[to]?.areaId) {
      toast.error("같은 영역 안에서만 순서를 변경할 수 있습니다.");
      return;
    }

    const reordered = [...filteredItems];
    const [moved] = reordered.splice(from, 1);
    if (!moved) return;
    reordered.splice(to, 0, moved);
    queryClient.setQueryData(queryKey, { items: reordered });
    sortMutation.mutate(reordered.map((f, i) => ({ funcId: f.funcId, sortOrder: i + 1 })));
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
    <div style={{ padding: 0 }}>
      {/* 헤더 타이틀 — full-width 배경, 좌: 타이틀 | 우: 버튼 */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 24px",
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)", flex: 1 }}>
          기능 정의 목록
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey })}
            style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 14px" }}
          >
            조회
          </button>
          <button
            onClick={() => {
              const orders = Object.entries(sortEdits).map(([funcId, sortOrder]) => ({ funcId, sortOrder }));
              if (orders.length === 0) { toast.info("변경된 정렬 순서가 없습니다."); return; }
              sortMutation.mutate(orders);
            }}
            disabled={sortMutation.isPending}
            style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 14px" }}
          >
            저장
          </button>
          <button
            onClick={() => {
              const url = areaIdFilter
                ? `/projects/${projectId}/functions/new?areaId=${areaIdFilter}`
                : `/projects/${projectId}/functions/new`;
              router.push(url);
            }}
            style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 14px" }}
          >
            + 신규 등록
          </button>
        </div>
      </div>

      {/* 검색 필터 바 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 24px 14px" }}>
        <select
          value={unitWorkFilter}
          onChange={(e) => handleUnitWorkChange(e.target.value)}
          style={filterSelectStyle}
        >
          <option value="">단위업무 전체</option>
          {unitWorkOptions.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        <select
          value={screenFilter}
          onChange={(e) => setScreenFilter(e.target.value)}
          style={filterSelectStyle}
        >
          <option value="">화면 전체</option>
          {screenOptions.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        {(unitWorkFilter || screenFilter) && (
          <button
            onClick={() => { setUnitWorkFilter(""); setScreenFilter(""); }}
            style={{ fontSize: 12, padding: "5px 10px", borderRadius: 5, border: "1px solid var(--color-border)", background: "none", cursor: "pointer", color: "var(--color-text-secondary)" }}
          >
            초기화
          </button>
        )}
      </div>

      {/* 총 건수 */}
      <div style={{ marginBottom: 16, fontSize: 14, color: "var(--color-text-secondary)", padding: "0 24px" }}>
        총 {filteredItems.length}건{filteredItems.length !== items.length && ` (전체 ${items.length}건)`}
      </div>

      {filteredItems.length === 0 ? (
        <div style={{ padding: "60px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
          등록된 기능이 없습니다.
        </div>
      ) : (
        <div style={{ padding: "0 24px 24px" }}>
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
          <div style={gridHeaderStyle}>
            <div />
            <div>단위업무</div>
            <div>화면</div>
            <div>영역</div>
            <div>기능명</div>
            <div style={{ textAlign: "center" }}>정렬</div>
            <div>유형</div>
            <div>복잡도</div>
            <div>공수</div>
            <div>상태</div>
            <div />
          </div>

          {filteredItems.map((fn, idx) => {
            const prev = filteredItems[idx - 1];
            // 이전 행과 같은 값이면 셀 숨김 (계층 그룹핑 효과)
            const showUnitWork = idx === 0 || fn.unitWorkId !== prev.unitWorkId;
            const showScreen   = idx === 0 || fn.screenId   !== prev.screenId;
            const showArea     = idx === 0 || fn.areaId     !== prev.areaId;

            return (
              <div
                key={fn.funcId}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragEnter={() => handleDragEnter(idx)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => router.push(`/projects/${projectId}/functions/${fn.funcId}`)}
                style={{
                  ...gridRowStyle,
                  borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                }}
              >
                <div style={{ cursor: "grab", color: "#aaa", userSelect: "none", paddingLeft: 4 }}>☰</div>

                {/* 단위업무명 */}
                <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                  {showUnitWork ? (fn.unitWorkId ? fn.unitWorkName : <span style={{ color: "#ccc" }}>-</span>) : ""}
                </div>

                {/* 화면명 */}
                <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                  {showScreen ? (fn.screenId ? fn.screenName : <span style={{ color: "#ccc" }}>-</span>) : ""}
                </div>

                {/* 영역명 (클릭 → 영역 상세, 행 클릭과 분리) */}
                <div onClick={(e) => e.stopPropagation()}>
                  {showArea ? (
                    fn.areaId ? (
                      <button
                        onClick={() => router.push(`/projects/${projectId}/areas/${fn.areaId}`)}
                        style={linkBtnStyle}
                      >
                        {fn.areaName}
                      </button>
                    ) : (
                      <span style={{ color: "#ccc", fontSize: 13 }}>-</span>
                    )
                  ) : ""}
                </div>

                {/* 기능명 */}
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  <span style={{ color: "var(--color-text-secondary)", fontSize: 11, marginRight: 3 }}>
                    {fn.displayId}
                  </span>
                  {fn.name}
                </div>

                {/* 정렬순서 — 직접 입력 가능 */}
                <div onClick={(e) => e.stopPropagation()}>
                  <input
                    type="number"
                    value={sortEdits[fn.funcId] ?? fn.sortOrder}
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      if (!isNaN(v)) setSortEdits((prev) => ({ ...prev, [fn.funcId]: v }));
                    }}
                    style={{
                      width: 44, textAlign: "center", fontSize: 12,
                      padding: "2px 4px", borderRadius: 4,
                      border: "1px solid var(--color-border)",
                      background: sortEdits[fn.funcId] !== undefined
                        ? "var(--color-bg-muted)"
                        : "var(--color-bg-card)",
                      color: "var(--color-text-primary)",
                      outline: "none",
                    }}
                  />
                </div>

                {/* 유형 배지 */}
                <div>
                  <span style={typeBadgeStyle(fn.type)}>{fn.type}</span>
                </div>

                {/* 복잡도 인라인 편집 (FID-00168) */}
                <div onClick={(e) => e.stopPropagation()}>
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
                <div onClick={(e) => e.stopPropagation()}>
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
                <div style={{ display: "flex", gap: 6, alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
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
            );
          })}
        </div>
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

const GRID_TEMPLATE = "32px 150px 187px 208px 1fr 50px 70px 80px 60px 80px 100px";

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
  cursor: "pointer",
};
const linkBtnStyle: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  color: "var(--color-primary, #1976d2)", fontSize: 13,
  padding: 0, textAlign: "left", textDecoration: "underline",
};
const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px", borderRadius: 6, border: "1px solid transparent",
  background: "var(--color-primary, #1976d2)", color: "#fff",
  fontSize: 14, fontWeight: 600, cursor: "pointer",
};
const secondaryBtnStyle: React.CSSProperties = {
  padding: "8px 16px", borderRadius: 6,
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-primary)", fontSize: 14, cursor: "pointer",
};
const filterSelectStyle: React.CSSProperties = {
  padding:         "5px 28px 5px 10px",
  borderRadius:    6,
  border:          "1px solid var(--color-border)",
  fontSize:        13,
  background:      "var(--color-bg-card)",
  color:           "var(--color-text-primary)",
  cursor:          "pointer",
  appearance:      "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
  backgroundRepeat:   "no-repeat",
  backgroundPosition: "right 8px center",
  minWidth: 160,
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
