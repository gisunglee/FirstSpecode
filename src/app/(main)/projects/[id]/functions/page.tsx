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
import AiTaskDetailDialog from "@/components/ui/AiTaskDetailDialog";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type AiTaskInfo = { taskId: string; status: string } | null;

type FuncRow = {
  funcId: string;
  displayId: string;
  name: string;
  type: string;
  priority: string;
  complexity: string;
  effort: string;
  sortOrder: number;
  areaId: string | null;
  assignMemberId: string | null;
  areaName: string;
  areaDisplayId: string | null;
  areaSortOrder: number;
  screenId: string | null;
  screenName: string;
  screenDisplayId: string | null;
  unitWorkId: string | null;
  unitWorkName: string;
  aiDesign: AiTaskInfo;
  aiInspect: AiTaskInfo;
  designRt: number;
  implRt: number;
  testRt: number;
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
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const projectId = params.id;
  const areaIdFilter = searchParams.get("areaId") ?? undefined;

  // AI 태스크 상세 팝업
  const [aiDetailTaskId, setAiDetailTaskId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // 인라인 편집 상태: { funcId, field } or null
  const [editingCell, setEditingCell] = useState<{ funcId: string; field: "complexity" | "effort" } | null>(null);
  const [editValue, setEditValue] = useState("");
  // 정렬순서 직접 입력 상태: { funcId → sortOrder }
  const [sortEdits, setSortEdits] = useState<Record<string, number>>({});

  // 검색 필터
  const [unitWorkFilter, setUnitWorkFilter] = useState("");
  const [screenFilter, setScreenFilter] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [memberFilter, setMemberFilter] = useState("");

  function handleUnitWorkChange(val: string) {
    setUnitWorkFilter(val);
    setScreenFilter(""); // 단위업무 바뀌면 화면 필터 초기화
    setAreaFilter("");
  }

  const dragItem = useRef<number | null>(null);
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

  const { data: membersData } = useQuery({
    queryKey: ["members", projectId],
    queryFn: () =>
      authFetch<{ data: { members: { memberId: string; name: string | null; email: string }[] } }>(
        `/api/projects/${projectId}/members`
      ).then((r) => r.data.members),
    staleTime: 60_000,
  });
  const memberNameMap = new Map((membersData ?? []).map((m) => [m.memberId, m.name ?? m.email]));

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

  // 영역 셀렉트 옵션 — 선택된 화면 기준으로 좁힘
  const areaOptions = Array.from(
    new Map(
      items
        .filter((f) => f.areaId && (!screenFilter || f.screenId === screenFilter))
        .map((f) => [f.areaId, `${f.areaDisplayId ?? ""} ${f.areaName}`.trim()])
    ).entries()
  ).map(([id, name]) => ({ id: id!, name }));

  // 담당자 셀렉트 옵션 (중복 제거)
  const memberOptions = Array.from(
    new Map(
      items
        .filter((f) => f.assignMemberId)
        .map((f) => [f.assignMemberId, f.assignMemberId!])
    ).entries()
  ).map(([id]) => ({ id: id! }));

  // 클라이언트 필터링
  const filteredItems = items.filter(
    (f) =>
      (!unitWorkFilter || f.unitWorkId === unitWorkFilter) &&
      (!screenFilter || f.screenId === screenFilter) &&
      (!areaFilter || f.areaId === areaFilter) &&
      (!memberFilter || f.assignMemberId === memberFilter)
  );

  // ── 순서 변경 ──────────────────────────────────────────────────────────────
  const sortMutation = useMutation({
    mutationFn: (orders: { funcId: string; sortOrder: number }[]) =>
      authFetch(`/api/projects/${projectId}/functions/sort`, {
        method: "PUT",
        body: JSON.stringify({ orders }),
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
    const to = dragOverItem.current;
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
        body: JSON.stringify({ field, value }),
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

      {/* 총 건수 + 검색 필터 바 (오른쪽 정렬) */}
      {/* padding-bottom 16 — 다른 목록(단위업무/화면/영역)의 필터 bottom 간격과 통일 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 24px 16px" }}>
        <span style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
          총 {filteredItems.length}건{filteredItems.length !== items.length && ` (전체 ${items.length}건)`}
        </span>
        <div style={{ flex: 1 }} />
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
          onChange={(e) => { setScreenFilter(e.target.value); setAreaFilter(""); }}
          style={filterSelectStyle}
        >
          <option value="">화면 전체</option>
          {screenOptions.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        <select
          value={areaFilter}
          onChange={(e) => setAreaFilter(e.target.value)}
          style={filterSelectStyle}
        >
          <option value="">영역 전체</option>
          {areaOptions.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        <select
          value={memberFilter}
          onChange={(e) => setMemberFilter(e.target.value)}
          style={filterSelectStyle}
        >
          <option value="">담당자 전체</option>
          {memberOptions.map((o) => (
            <option key={o.id} value={o.id}>{memberNameMap.get(o.id) ?? o.id}</option>
          ))}
        </select>
        {(unitWorkFilter || screenFilter || areaFilter || memberFilter) && (
          <button
            onClick={() => { setUnitWorkFilter(""); setScreenFilter(""); setAreaFilter(""); setMemberFilter(""); }}
            style={{ fontSize: 12, padding: "5px 10px", borderRadius: 5, border: "1px solid var(--color-border)", background: "none", cursor: "pointer", color: "var(--color-text-secondary)" }}
          >
            초기화
          </button>
        )}
      </div>

      {/* 목록 — 빈 상태에서도 헤더 표시 (과업 페이지 패턴과 통일) */}
      <div style={{ padding: "0 24px 24px" }}>
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
          <div style={gridHeaderStyle}>
            <div />
            <div>단위업무 명</div>
            <div>화면 명</div>
            <div>영역 명</div>
            <div>기능명</div>
            <div style={{ textAlign: "center" }}>정렬</div>
            <div>유형</div>
            <div>복잡도</div>
            <div>공수</div>
            <div style={{ textAlign: "center" }}>AI</div>
            <div style={{ textAlign: "center", paddingLeft: 8 }}>설/구/테</div>
          </div>

          {filteredItems.length === 0 ? (
            <div style={{ padding: "64px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
              등록된 기능이 없습니다.
            </div>
          ) : (
            filteredItems.map((fn, idx) => {
              const prev = filteredItems[idx - 1];
              // 이전 행과 같은 값이면 셀 숨김 (계층 그룹핑 효과)
              const showUnitWork = idx === 0 || fn.unitWorkId !== prev.unitWorkId;
              const showScreen = idx === 0 || fn.screenId !== prev.screenId;
              const showArea = idx === 0 || fn.areaId !== prev.areaId;

              return (
                <div
                  key={fn.funcId}
                  draggable
                  onDragStart={() => handleDragStart(idx)}
                  onDragEnter={() => handleDragEnter(idx)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => e.preventDefault()}
                  onClick={() => router.push(`/projects/${projectId}/functions/${fn.funcId}`)}
                  onMouseEnter={() => setHoveredId(fn.funcId)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    ...gridRowStyle,
                    borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                    background: hoveredId === fn.funcId
                      ? (fn.designRt === 100 && fn.implRt === 100 && fn.testRt === 100
                        ? "rgba(34,197,94,0.10)"
                        : "var(--color-bg-hover, rgba(99,102,241,0.06))")
                      : (fn.designRt === 100 && fn.implRt === 100 && fn.testRt === 100
                        ? "rgba(34,197,94,0.04)"
                        : "var(--color-bg-card)"),
                    borderLeft: fn.designRt === 100 && fn.implRt === 100 && fn.testRt === 100
                      ? "3px solid #22c55e"
                      : hoveredId === fn.funcId ? "3px solid var(--color-primary, #6366f1)" : "3px solid transparent",
                    paddingLeft: 13,
                  }}
                >
                  <div style={{ cursor: "grab", color: "#aaa", userSelect: "none", paddingLeft: 4 }}>☰</div>

                  {/* 단위업무명 (클릭 → 단위업무 상세, 행 클릭과 분리) */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={showUnitWork ? fn.unitWorkName : undefined}
                  >
                    {showUnitWork ? (
                      fn.unitWorkId ? (
                        <button onClick={() => router.push(`/projects/${projectId}/unit-works/${fn.unitWorkId}`)} style={linkBtnStyle}>
                          {fn.unitWorkName}
                        </button>
                      ) : (
                        <span style={{ color: "#ccc", fontSize: 13 }}>-</span>
                      )
                    ) : ""}
                  </div>

                  {/* 화면명 (클릭 → 화면 상세, 행 클릭과 분리) */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={showScreen ? fn.screenName : undefined}
                  >
                    {showScreen ? (
                      fn.screenId ? (
                        <button onClick={() => router.push(`/projects/${projectId}/screens/${fn.screenId}`)} style={linkBtnStyle}>
                          {fn.screenName}
                        </button>
                      ) : (
                        <span style={{ color: "#ccc", fontSize: 13 }}>-</span>
                      )
                    ) : ""}
                  </div>

                  {/* 영역명 (클릭 → 영역 상세, 행 클릭과 분리) */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={showArea ? fn.areaName : undefined}
                  >
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

                  {/* 기능명 — flex 자식 중 name 만 ellipsis(min-width:0), displayId/완료배지는 shrink 금지 */}
                  <div
                    style={{
                      fontSize: 14, fontWeight: 500,
                      display: "flex", alignItems: "center", gap: 8,
                      overflow: "hidden", whiteSpace: "nowrap", minWidth: 0,
                    }}
                    title={`${fn.displayId} ${fn.name}`}
                  >
                    <span style={{ color: "var(--color-text-secondary)", fontSize: 11, flexShrink: 0 }}>
                      {fn.displayId}
                    </span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
                      {fn.name}
                    </span>
                    {fn.designRt === 100 && fn.implRt === 100 && fn.testRt === 100 && (
                      <span style={{
                        fontSize: 11, fontWeight: 600, color: "#16a34a",
                        background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)",
                        borderRadius: 4, padding: "1px 7px", whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}>
                        ✓ 완료
                      </span>
                    )}
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
                    <span className="sp-badge" style={typeBadgeStyle(fn.type)}>{fn.type}</span>
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
                        className="sp-badge"
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

                  {/* AI 진행 현황 인디케이터 */}
                  <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "center" }} onClick={(e) => e.stopPropagation()}>
                    <AiDot label="설" taskInfo={fn.aiDesign} onClick={(id) => setAiDetailTaskId(id)} />
                    <AiDot label="검" taskInfo={fn.aiInspect} onClick={(id) => setAiDetailTaskId(id)} />
                  </div>

                  {/* 설계/구현/테스트 비율 */}
                  {fn.designRt === 100 && fn.implRt === 100 && fn.testRt === 100 ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingLeft: 8 }}>
                      <span style={{
                        background: "linear-gradient(90deg, #1565c0, #2e7d32, #6a1b9a)",
                        color: "#fff",
                        borderRadius: 6,
                        padding: "2px 8px",
                        fontSize: 11,
                        fontWeight: 800,
                        letterSpacing: "0.5px",
                        whiteSpace: "nowrap",
                      }}>
                        100점 🎉
                      </span>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 3, alignItems: "center", justifyContent: "center", paddingLeft: 8 }}>
                      <RatioChip label="설" value={fn.designRt} color="#1565c0" />
                      <RatioChip label="구" value={fn.implRt} color="#2e7d32" />
                      <RatioChip label="테" value={fn.testRt} color="#6a1b9a" />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* AI 태스크 상세 팝업 */}
      {aiDetailTaskId && (
        <AiTaskDetailDialog
          projectId={projectId}
          taskId={aiDetailTaskId}
          onClose={() => setAiDetailTaskId(null)}
          onRejected={() => { setAiDetailTaskId(null); queryClient.invalidateQueries({ queryKey }); }}
        />
      )}

    </div>
  );
}

// ── 비율 칩 ──────────────────────────────────────────────────────────────────

function RatioChip({ label, value, color }: { label: string; value: number; color: string }) {
  const fullLabel = label === "설" ? "설계" : label === "구" ? "구현" : "테스트";
  return (
    <span
      title={`${fullLabel}: ${value}%`}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 700, lineHeight: 1,
        color: value > 0 ? color : "#bbb",
        minWidth: 30,
      }}
    >
      {value}%
    </span>
  );
}

// ── AI 인디케이터 동그라미 ─────────────────────────────────────────────────────

const AI_DOT_COLORS: Record<string, { bg: string; border: string; text: string; label: string }> = {
  DONE: { bg: "#1976d2", border: "#1565c0", text: "#fff", label: "완료" },
  APPLIED: { bg: "#2e7d32", border: "#1b5e20", text: "#fff", label: "적용됨" },
  REJECTED: { bg: "#c62828", border: "#b71c1c", text: "#fff", label: "반려됨" },
  FAILED: { bg: "#e65100", border: "#bf360c", text: "#fff", label: "실패" },
  TIMEOUT: { bg: "#e65100", border: "#bf360c", text: "#fff", label: "타임아웃" },
  IN_PROGRESS: { bg: "#f59e0b", border: "#d97706", text: "#fff", label: "진행중" },
  PENDING: { bg: "#9e9e9e", border: "#757575", text: "#fff", label: "대기중" },
};

function AiDot({ label, taskInfo, onClick }: {
  label: string;
  taskInfo: AiTaskInfo;
  onClick: (taskId: string) => void;
}) {
  const active = taskInfo !== null;
  const colorCfg = taskInfo ? (AI_DOT_COLORS[taskInfo.status] ?? AI_DOT_COLORS.DONE) : null;
  const fullLabel = label === "설" ? "설계" : "점검";
  const title = active ? `AI ${fullLabel}: ${colorCfg?.label}` : `AI ${fullLabel} 미진행`;

  return (
    <button
      className="sp-badge"
      title={title}
      onClick={() => active && taskInfo && onClick(taskInfo.taskId)}
      style={{
        // 다른 목록 페이지의 배지(약 20~22px)와 세로 높이를 맞춰 row 간 통일감 유지.
        width: 22, height: 22, borderRadius: "50%",
        border: active ? `2px solid ${colorCfg!.border}` : "2px solid #d0d0d0",
        background: active ? colorCfg!.bg : "#f0f0f0",
        cursor: active ? "pointer" : "default",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 10, fontWeight: 700, letterSpacing: "-0.3px",
        color: active ? colorCfg!.text : "#bbb",
        flexShrink: 0, padding: 0,
        boxShadow: active ? `0 1px 3px ${colorCfg!.border}55` : "none",
        transition: "transform 0.15s, box-shadow 0.15s",
      }}
      onMouseEnter={(e) => {
        if (active) {
          e.currentTarget.style.transform = "scale(1.18)";
          e.currentTarget.style.boxShadow = `0 2px 6px ${colorCfg!.border}88`;
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "scale(1)";
        e.currentTarget.style.boxShadow = active ? `0 1px 3px ${colorCfg!.border}55` : "none";
      }}
    >
      {label}
    </button>
  );
}

// ── 상수·스타일 ───────────────────────────────────────────────────────────────


function typeBadgeStyle(type: string): React.CSSProperties {
  return {
    display: "inline-block", padding: "2px 6px", borderRadius: 4,
    fontSize: 11, fontWeight: 600, background: "#e3f2fd", color: "#1565c0",
  };
}

function complexityBadgeStyle(c: string): React.CSSProperties {
  const map: Record<string, { bg: string; color: string }> = {
    HIGH: { bg: "#fce4ec", color: "#880e4f" },
    MEDIUM: { bg: "#fff3e0", color: "#e65100" },
    LOW: { bg: "#e8f5e9", color: "#2e7d32" },
  };
  const s = map[c] ?? { bg: "#f5f5f5", color: "#555" };
  return { display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, ...s };
}


// 단위업무·화면·영역·기능명은 fr로 비율 분배, 나머지 소형 컬럼은 고정.
// 좁은 폭에서도 텍스트가 줄바꿈되지 않도록 ellipsis 처리와 함께 사용.
//   기능명(3fr)이 가장 큰 비중, 영역명(2fr), 단위업무·화면(1.5fr) 순.
//   유형/복잡도 배지는 4~6자라 60/70px, AI 인디케이터는 22px 도트 2개라 55px.
const GRID_TEMPLATE = "32px 1.5fr 1.5fr 2fr 3fr 44px 60px 70px 55px 55px 88px";

const gridHeaderStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: GRID_TEMPLATE, gap: 8,
  padding: "10px 16px", background: "var(--color-bg-muted)",
  fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)",
  borderBottom: "1px solid var(--color-border)", alignItems: "center",
};
const gridRowStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: GRID_TEMPLATE, gap: 8,
  padding: "12px 16px", alignItems: "center",
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
