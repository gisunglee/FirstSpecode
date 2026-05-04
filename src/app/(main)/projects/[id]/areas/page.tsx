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
import AiTaskDetailDialog from "@/components/ui/AiTaskDetailDialog";
import { type AiTaskStatus, AI_TASK_STATUS_LABEL, AI_TASK_STATUS_BADGE } from "@/constants/codes";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type AreaRow = {
  areaId: string;
  displayId: string;
  name: string;
  type: string;
  sortOrder: number;
  screenId: string | null;
  screenName: string;
  screenDisplayId: string | null;
  unitWorkId: string | null;
  unitWorkName: string | null;
  functionCount: number;
  totalEffortHours: number;
  implStart: string | null;
  implEnd: string | null;
  avgDesignRt: number;
  avgImplRt: number;
  avgTestRt: number;
  // AI 구현 요청 정보 (스냅샷 → IMPLEMENT 태스크 최신 1건)
  implTask: { aiTaskId: string; status: string; requestedAt: string } | null;
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
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const projectId = params.id;

  // 화면 필터 (URL ?screenId=xxx 로 초기화 — 브레드크럼에서 진입 시 자동 적용)
  const [screenFilter, setScreenFilter] = useState(searchParams.get("screenId") ?? "");

  // 삭제 다이얼로그 상태
  const [deleteTarget, setDeleteTarget] = useState<AreaRow | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // AI 구현 태스크 상세 팝업
  const [aiDetailTaskId, setAiDetailTaskId] = useState<string | null>(null);

  // ── 드래그 상태 ────────────────────────────────────────────────────────────
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  // 드래그 중인 아이템의 screenId — 동일 화면 내에서만 순서 변경 허용
  const dragItemScreenId = useRef<string | null>(null);

  // 캐시 무효화/낙관적 업데이트를 위해 queryKey를 상수로 추출
  const queryKey = ["areas", projectId];

  // ── 데이터 조회 — 전체 조회 후 클라이언트 필터 (드롭다운 옵션 생성용) ─────
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      authFetch<{ data: { items: AreaRow[]; totalCount: number } }>(
        `/api/projects/${projectId}/areas`
      ).then((r) => r.data),
  });

  const allItems = data?.items ?? [];

  // 화면 드롭다운 옵션 — items에서 중복 제거하여 추출
  const screenOptions = Array.from(
    new Map(allItems.filter((a) => a.screenId).map((a) => [a.screenId, a.screenName])).entries()
  ).map(([id, name]) => ({ id: id!, name }));

  // 필터 적용
  const items = screenFilter
    ? allItems.filter((a) => a.screenId === screenFilter)
    : allItems;

  // ── 순서 변경 뮤테이션 ──────────────────────────────────────────────────────
  const sortMutation = useMutation({
    mutationFn: (orders: { areaId: string; sortOrder: number }[]) =>
      authFetch(`/api/projects/${projectId}/areas/sort`, {
        method: "PUT",
        body: JSON.stringify({ orders }),
      }),
    onError: () => {
      toast.error("순서 변경에 실패했습니다.");
      queryClient.invalidateQueries({ queryKey });
    },
  });

  // ── 드래그 핸들러 ──────────────────────────────────────────────────────────
  function handleDragStart(index: number) {
    dragItem.current = index;
    dragItemScreenId.current = items[index]?.screenId ?? null;
  }

  function handleDragEnter(index: number) {
    // 드래그 중인 아이템과 다른 화면의 영역 위에 올라오면 무시
    // (같은 screenId 내에서만 순서 변경 허용)
    if (items[index]?.screenId !== dragItemScreenId.current) return;
    dragOverItem.current = index;
  }

  function handleDragEnd() {
    const from = dragItem.current;
    const to = dragOverItem.current;

    // 초기화는 항상
    dragItem.current = null;
    dragOverItem.current = null;
    dragItemScreenId.current = null;

    if (from === null || to === null || from === to) return;

    // 방어: 서로 다른 화면으로 떨어진 경우 (handleDragEnter에서 막혔어도 이중 검증)
    if (items[from]?.screenId !== items[to]?.screenId) {
      toast.error("같은 화면(Screen) 내에서만 순서를 변경할 수 있습니다.");
      return;
    }

    const reordered = [...items];
    const [moved] = reordered.splice(from, 1);
    if (!moved) return;
    reordered.splice(to, 0, moved);

    // 낙관적 업데이트 후 서버 동기화
    queryClient.setQueryData(queryKey, { items: reordered, totalCount: reordered.length });

    const orders = reordered.map((a, idx) => ({ areaId: a.areaId, sortOrder: idx + 1 }));
    sortMutation.mutate(orders);
  }

  // ── 로딩 ───────────────────────────────────────────────────────────────────
  if (isLoading) {
    return <div style={{ padding: "40px 32px", color: "#888" }}>로딩 중...</div>;
  }

  return (
    <div style={{ padding: 0 }}>
      {/* 헤더 — full-width 배경 */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 24px",
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
          영역 목록
        </div>
        <button
          onClick={() => {
            const url = screenFilter
              ? `/projects/${projectId}/areas/new?screenId=${screenFilter}`
              : `/projects/${projectId}/areas/new`;
            router.push(url);
          }}
          style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 14px" }}
        >
          + 신규 등록
        </button>
      </div>

      <div style={{ padding: "0 24px 24px" }}>
        {/* 총 건수 + 필터 (오른쪽 정렬) */}
        <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
            총 {items.length}건
          </span>
          <div style={{ flex: 1 }} />
          <select
            value={screenFilter}
            onChange={(e) => setScreenFilter(e.target.value)}
            style={filterSelectStyle}
          >
            <option value="">화면 전체</option>
            {screenOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.name}</option>
            ))}
          </select>
        </div>

        {/* 목록 — 빈 상태에서도 헤더 표시 (과업 페이지 패턴과 통일) */}
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
          {/* 헤더 행 */}
          <div style={gridHeaderStyle}>
            <div />
            <div>단위업무 명</div>
            <div>화면 명</div>
            <div>영역 명</div>
            <div>유형</div>
            <div style={{ textAlign: "center" }}>정렬</div>
            <div style={{ textAlign: "center" }}>기능수</div>
            <div style={{ textAlign: "center" }}>구현기간</div>
            <div style={{ textAlign: "center" }}>예상공수</div>
            <div style={{ textAlign: "center" }}>AI 구현</div>
            <div style={{ textAlign: "center" }}>설/구/테</div>
          </div>

          {items.length === 0 ? (
            <div style={{ padding: "64px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
              등록된 영역이 없습니다.
            </div>
          ) : (
            /* 데이터 행 */
            items.map((area, idx) => (
              <div
                key={area.areaId}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragEnter={() => handleDragEnter(idx)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => router.push(`/projects/${projectId}/areas/${area.areaId}`)}
                onMouseEnter={() => setHoveredId(area.areaId)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  ...gridRowStyle,
                  borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                  background: hoveredId === area.areaId ? "var(--color-bg-hover, rgba(99,102,241,0.06))" : "var(--color-bg-card)",
                  borderLeft: hoveredId === area.areaId ? "3px solid var(--color-primary, #6366f1)" : "3px solid transparent",
                  paddingLeft: 13,
                }}
              >
                {/* 드래그 핸들 */}
                <div style={{ cursor: "grab", color: "#aaa", userSelect: "none", paddingLeft: 4 }}>☰</div>

                {/* 단위업무명 — 같은 unitWorkId이면 첫 행에만 표시, 클릭 시 단위업무 상세로 이동 */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={area.unitWorkName ?? undefined}
                >
                  {items[idx - 1]?.unitWorkId === area.unitWorkId && area.unitWorkId
                    ? null
                    : area.unitWorkId ? (
                      <button
                        onClick={() => router.push(`/projects/${projectId}/unit-works/${area.unitWorkId}`)}
                        style={{ ...linkBtnStyle, fontSize: 13 }}
                      >
                        {area.unitWorkName}
                      </button>
                    ) : (
                      <span style={{ color: "#aaa", fontSize: 13 }}>-</span>
                    )
                  }
                </div>

                {/* 화면명 — 같은 화면(screenId)이면 첫 행에만 표시 */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={area.screenName ?? undefined}
                >
                  {items[idx - 1]?.screenId === area.screenId && area.screenId
                    ? null
                    : area.screenId ? (
                      <button
                        onClick={() => router.push(`/projects/${projectId}/screens/${area.screenId}`)}
                        style={linkBtnStyle}
                      >
                        {area.screenName}
                      </button>
                    ) : (
                      <span style={{ color: "#aaa", fontSize: 13 }}>미분류</span>
                    )
                  }
                </div>

                {/* 영역명 — displayId + name 한 줄. 좁은 폭에서는 ellipsis (title로 전체 노출) */}
                <div
                  style={{
                    fontSize: 14, fontWeight: 500,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                  title={`${area.displayId} ${area.name}`}
                >
                  <span style={{ color: "var(--color-text-secondary)", fontSize: 12, marginRight: 6 }}>
                    {area.displayId}
                  </span>
                  {area.name}
                </div>

                {/* 유형 배지 — 표시 형태 배지는 행 높이가 늘어나서 목록에서는 제거. 필요하면 영역 편집에서 확인. */}
                <div>
                  <span style={typeBadgeStyle(area.type)}>
                    {area.type}
                  </span>
                </div>

                {/* 정렬순서 */}
                <div style={{ textAlign: "center", fontSize: 13, color: "var(--color-text-secondary)" }}>
                  {area.sortOrder}
                </div>

                {/* 기능 수 */}
                <div style={{ textAlign: "center", fontSize: 13, color: "var(--color-text-secondary)" }}>
                  {area.functionCount}
                </div>

                {/* 구현기간 — 가장 빠른 시작일 ~ 가장 늦은 종료일 (한 줄 표시) */}
                <div style={{ textAlign: "center", fontSize: 11, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
                  {area.implStart || area.implEnd ? (
                    <>{area.implStart ?? "-"} ~ {area.implEnd ?? "-"}</>
                  ) : (
                    <span style={{ color: "#ccc" }}>-</span>
                  )}
                </div>

                {/* 예상공수 — D/H 형식 */}
                <div style={{ textAlign: "center", fontSize: 12, color: "var(--color-text-secondary)" }}>
                  {area.totalEffortHours > 0
                    ? (() => {
                      const d = Math.floor(area.totalEffortHours / 8);
                      const h = area.totalEffortHours % 8;
                      const parts = [];
                      if (d > 0) parts.push(`${d}d`);
                      if (h > 0) parts.push(`${h}h`);
                      return (
                        <>
                          <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{parts.join(" ")}</span>
                          <span style={{ marginLeft: 4, fontSize: 11, color: "#aaa" }}>({area.totalEffortHours}h)</span>
                        </>
                      );
                    })()
                    : <span style={{ color: "#ccc" }}>-</span>
                  }
                </div>

                {/* AI 구현 — 스냅샷 경유 IMPLEMENT 태스크 최신 1건.
                  배지 + 시간을 한 줄(flex row)로 배치해 row 전체 높이가 늘어나지 않도록 함. */}
                <div
                  style={{ display: "flex", justifyContent: "center" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {area.implTask ? (
                    <button
                      onClick={() => setAiDetailTaskId(area.implTask!.aiTaskId)}
                      title={`AI 구현 태스크 · ${formatRequestedAt(area.implTask.requestedAt)}`}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        background: "transparent", border: "none", padding: 0, cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span style={implStatusBadgeStyle(area.implTask.status)}>
                        {AI_TASK_STATUS_LABEL[area.implTask.status as AiTaskStatus] ?? area.implTask.status}
                      </span>
                      <span style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>
                        {formatRequestedAt(area.implTask.requestedAt)}
                      </span>
                    </button>
                  ) : (
                    <span style={{ color: "#ccc", fontSize: 13 }}>—</span>
                  )}
                </div>

                {/* 설/구/테 평균 진행률 */}
                <div style={{ display: "flex", gap: 4, justifyContent: "center", fontSize: 11 }}>
                  {[
                    { label: "설", val: area.avgDesignRt, color: "#1565c0" },
                    { label: "구", val: area.avgImplRt, color: "#2e7d32" },
                    { label: "테", val: area.avgTestRt, color: "#6a1b9a" },
                  ].map(({ label, val, color }) => (
                    <span key={label} style={{
                      color, fontWeight: 600,
                      background: val === 100 ? `${color}14` : "transparent",
                      borderRadius: 3, padding: "1px 3px",
                    }}>
                      {val}%
                    </span>
                  ))}
                </div>

              </div>
            ))
          )}
        </div>
      </div>

      {/* PID-00049 삭제 확인 팝업 */}
      {deleteTarget && (
        <DeleteConfirmDialog
          area={deleteTarget}
          projectId={projectId}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            queryClient.invalidateQueries({ queryKey: ["areas", projectId] });
          }}
        />
      )}

      {/* AI 구현 태스크 상세 팝업 */}
      {aiDetailTaskId && (
        <AiTaskDetailDialog
          projectId={projectId}
          taskId={aiDetailTaskId}
          onClose={() => setAiDetailTaskId(null)}
        />
      )}
    </div>
  );
}

// ── PID-00049 삭제 확인 다이얼로그 ───────────────────────────────────────────

function DeleteConfirmDialog({
  area, projectId, onClose, onDeleted,
}: {
  area: AreaRow;
  projectId: string;
  onClose: () => void;
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
  // 신규 분류 5종 — 데이터 성격 기준
  const colors: Record<string, { bg: string; color: string }> = {
    FILTER:  { bg: "#e3f2fd", color: "#1565c0" },
    LIST:    { bg: "#e8f5e9", color: "#2e7d32" },
    FORM:    { bg: "#fff3e0", color: "#e65100" },
    DETAIL:  { bg: "#f3e5f5", color: "#6a1b9a" },
    GENERAL: { bg: "#eceff1", color: "#37474f" },
  };
  const c = colors[type] ?? { bg: "#f5f5f5", color: "#555" };
  return {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 600,
    background: c.bg,
    color: c.color,
  };
}


// ── AI 태스크 상태 배지 스타일 (AI 구현 컬럼용) ─────────────────────
// 상태 라벨·색상은 공용 codes 모듈(@/constants/codes)에서 가져옴

function implStatusBadgeStyle(status: string): React.CSSProperties {
  const c = AI_TASK_STATUS_BADGE[status as AiTaskStatus] ?? { bg: "#f5f5f5", fg: "#555" };
  return {
    display: "inline-block", padding: "2px 8px", borderRadius: 4,
    fontSize: 11, fontWeight: 700, background: c.bg, color: c.fg,
    whiteSpace: "nowrap",
  };
}

function formatRequestedAt(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

// 단위업무·화면·영역명은 fr 비율로(가변), 배지/숫자/날짜 등은 고정폭으로 안정화.
// 좁은 화면에서도 텍스트 셀이 ellipsis 로 자연스럽게 잘리도록 화면 목록과 동일한 패턴 사용.
//   유형 60px(GRID/FORM 등 4자) · 정렬 40px · 기능수 50px
//   구현기간 140px("2026-04-13 ~ 2026-04-23" 23자 nowrap)
//   예상공수 90px("5h (5h)") · AI 구현 130px(배지+MM-DD HH:mm) · 설/구/테 80px
const GRID_TEMPLATE = "32px 1.2fr 1.2fr 2fr 60px 40px 50px 140px 90px 130px 80px";

const gridHeaderStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: GRID_TEMPLATE,
  gap: 12,
  padding: "10px 16px",
  background: "var(--color-bg-muted)",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--color-text-secondary)",
  borderBottom: "1px solid var(--color-border)",
  alignItems: "center",
};

const gridRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: GRID_TEMPLATE,
  gap: 12,
  padding: "12px 16px",
  alignItems: "center",
  background: "var(--color-bg-card)",
  transition: "background 0.1s",
  cursor: "pointer",
};

const linkBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--color-primary, #1976d2)",
  fontSize: 14,
  padding: 0,
  textAlign: "left",
  textDecoration: "underline",
};

const filterSelectStyle: React.CSSProperties = {
  padding: "7px 32px 7px 12px",
  borderRadius: 6,
  border: "1px solid var(--color-border)",
  fontSize: 13,
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  cursor: "pointer",
  outline: "none",
  appearance: "none",
  WebkitAppearance: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 10px center",
  minWidth: 160,
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px",
  borderRadius: 6,
  border: "1px solid transparent",
  background: "var(--color-primary, #1976d2)",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 14,
  cursor: "pointer",
};

const dangerBtnStyle: React.CSSProperties = {
  padding: "4px 12px",
  borderRadius: 4,
  border: "1px solid #e53935",
  background: "transparent",
  color: "#e53935",
  fontSize: 12,
  cursor: "pointer",
};

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const dialogStyle: React.CSSProperties = {
  background: "var(--color-bg-card)",
  borderRadius: 10,
  padding: "28px 32px",
  minWidth: 380,
  maxWidth: 480,
  boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
};
