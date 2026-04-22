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

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type RequirementRow = {
  requirementId:    string;
  displayId:        string;
  name:             string;
  priority:         string;
  source:           string;
  taskId:           string | null;
  taskName:         string;
  // 담당자 — 서버 join으로 내려옴. 미지정/퇴장 멤버면 null
  assignMemberId:   string | null;
  assignMemberName: string | null;
  unitWorkCount:    number;
  sortOrder:        number;
};

// 과업 필터 드롭다운 옵션
type TaskOption = { taskId: string; name: string };

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
  const params       = useParams<{ id: string }>();
  const router       = useRouter();
  const searchParams = useSearchParams();
  const queryClient  = useQueryClient();
  const projectId    = params.id;

  // ── 필터 상태 ────────────────────────────────────────────────────────────────
  // 과업 필터: URL ?taskId=xxx (과업 상세 → "요구사항 목록" 링크) 진입 시 초기값 반영.
  // 이후 사용자가 드롭다운에서 변경하면 state 로만 관리 (URL 동기화는 생략 — 단순성 우선).
  const initialTaskFilter = searchParams.get("taskId") ?? "";
  const [taskFilter, setTaskFilter] = useState(initialTaskFilter);
  const [keyword, setKeyword]       = useState("");
  // 담당자 필터 — "all"(기본) | "me"(내 담당만). URL ?assignedTo=me 로 공유 가능
  const [filterAssignedTo, setFilterAssignedTo] = useState<"all" | "me">(
    searchParams.get("assignedTo") === "me" ? "me" : "all"
  );

  // "내 담당" 필터 URL 동기화 — 공유 URL 복원 가능
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (filterAssignedTo === "me") url.searchParams.set("assignedTo", "me");
    else url.searchParams.delete("assignedTo");
    window.history.replaceState(null, "", url.toString());
  }, [filterAssignedTo]);

  // 삭제 다이얼로그 상태
  const [deleteTarget, setDeleteTarget] = useState<RequirementRow | null>(null);

  // ── 과업 옵션 조회 (필터 드롭다운용) ──────────────────────────────────────
  const { data: tasksData } = useQuery({
    queryKey: ["tasks-for-filter", projectId],
    queryFn:  () =>
      authFetch<{ data: { tasks: TaskOption[] } }>(
        `/api/projects/${projectId}/tasks`
      ).then((r) => r.data.tasks),
  });
  const taskOptions = tasksData ?? [];

  // ── 드래그 상태 ────────────────────────────────────────────────────────────
  const dragItem     = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  // ── 데이터 조회 ────────────────────────────────────────────────────────────
  const { data, isLoading, error } = useQuery({
    queryKey: ["requirements", projectId, filterAssignedTo],
    queryFn:  () => {
      const qs = filterAssignedTo === "me" ? "?assignedTo=me" : "";
      return authFetch<{ data: { items: RequirementRow[]; totalCount: number } }>(
        `/api/projects/${projectId}/requirements${qs}`
      ).then((r) => r.data);
    },
  });
  
  const isError = !!error;
  const allItems = isError ? [] : (data?.items ?? []);

  // 필터 + 키워드 검색 (클라이언트 측) — 기능 정의 목록과 같은 패턴
  const kw = keyword.trim().toLowerCase();
  const items = allItems.filter((r) => {
    if (taskFilter && r.taskId !== taskFilter) return false;
    if (!kw) return true;
    return (
      r.name.toLowerCase().includes(kw) ||
      r.displayId.toLowerCase().includes(kw) ||
      (r.taskName ?? "").toLowerCase().includes(kw)
    );
  });
  const totalCount = items.length;
  const isFiltered = !!taskFilter || !!kw;

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
    <div style={{ padding: 0 }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)", marginBottom: 16 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
          요구사항 목록
        </div>
        <button
          onClick={() => router.push(`/projects/${projectId}/requirements/new`)}
          style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 14px" }}
        >
          + 신규 등록
        </button>
      </div>

      <div style={{ padding: "0 24px 24px" }}>
      {/* 총 건수 (왼쪽) + 필터 바 (오른쪽) — 기능 정의 목록과 동일 패턴 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
          총 {totalCount}건{isFiltered && allItems.length !== totalCount && ` (전체 ${allItems.length}건)`}
        </span>
        <div style={{ flex: 1 }} />
        {/* 담당자 세그먼트 토글 — 서버 쿼리 파라미터(?assignedTo=me)로 필터 */}
        <div style={segmentGroupStyle}>
          <button
            type="button"
            onClick={() => setFilterAssignedTo("all")}
            style={segmentBtnStyle(filterAssignedTo === "all")}
          >
            전체
          </button>
          <button
            type="button"
            onClick={() => setFilterAssignedTo("me")}
            style={segmentBtnStyle(filterAssignedTo === "me")}
          >
            내 담당
          </button>
        </div>
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="요구사항명·ID 검색..."
          style={filterInputStyle}
        />
        <select
          value={taskFilter}
          onChange={(e) => setTaskFilter(e.target.value)}
          style={filterSelectStyle}
        >
          <option value="">과업 전체</option>
          {taskOptions.map((t) => (
            <option key={t.taskId} value={t.taskId}>{t.name}</option>
          ))}
        </select>
        {isFiltered && (
          <button
            onClick={() => { setTaskFilter(""); setKeyword(""); }}
            style={{ fontSize: 12, padding: "5px 10px", borderRadius: 5, border: "1px solid var(--color-border)", background: "none", cursor: "pointer", color: "var(--color-text-secondary)" }}
          >
            초기화
          </button>
        )}
      </div>

      {/* 목록 */}
      {items.length === 0 ? (
        <div style={{ padding: "64px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
          {isError ? "접근 권한이 없거나 프로젝트 정보를 찾을 수 없습니다." : "등록된 요구사항이 없습니다."}
        </div>
      ) : (
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
          {/* 헤더 행 */}
          <div style={gridHeaderStyle}>
            <div />
            <div>과업명</div>
            <div>요구사항명</div>
            <div>담당자</div>
            <div>우선순위</div>
            <div>출처</div>
            <div style={{ textAlign: "center" }}>단위업무</div>
            <div style={{ textAlign: "center" }}>정렬</div>
          </div>

          {/* 데이터 행 — 동일 과업명 연속 시 첫 행에만 표시 */}
          {items.map((req, idx) => {
            // 이전 행과 과업이 같으면 과업명 숨김
            const prevTaskId = idx > 0 ? items[idx - 1].taskId : null;
            const showTaskName = req.taskId !== prevTaskId;

            return (
              <div
                key={req.requirementId}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragEnter={() => handleDragEnter(idx)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => router.push(`/projects/${projectId}/requirements/${req.requirementId}`)}
                style={{
                  ...gridRowStyle,
                  borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                }}
              >
                {/* 드래그 핸들 */}
                <div style={{ cursor: "grab", color: "#aaa", userSelect: "none", paddingLeft: 4 }}>
                  ☰
                </div>

                {/* 과업명 — 동일 과업 연속 시 첫 행에만 표시 */}
                <div onClick={(e) => e.stopPropagation()}>
                  {showTaskName ? (
                    req.taskId ? (
                      <button
                        onClick={() => router.push(`/projects/${projectId}/tasks/${req.taskId}`)}
                        style={linkBtnStyle}
                      >
                        {req.taskName}
                      </button>
                    ) : (
                      <span style={{ color: "#aaa", fontSize: 13 }}>미분류</span>
                    )
                  ) : null}
                </div>

                {/* 요구사항명 */}
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  <span style={{ color: "var(--color-text-secondary)", fontSize: 12, marginRight: 6 }}>
                    {req.displayId}
                  </span>
                  {req.name}
                </div>

                {/* 담당자 — 미지정/퇴장 멤버는 흐린 "-" */}
                <div
                  style={{
                    fontSize: 13,
                    color: req.assignMemberName
                      ? "var(--color-text-primary)"
                      : "var(--color-text-tertiary)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                  title={req.assignMemberName ?? undefined}
                >
                  {req.assignMemberName ?? "-"}
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

                {/* 정렬 순서 */}
                <div style={{ textAlign: "center", fontSize: 13, color: "var(--color-text-secondary)" }}>
                  {req.sortOrder || "-"}
                </div>

              </div>
            );
          })}
        </div>
      )}

      </div>

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

// 드래그핸들 / 과업명 / 요구사항명 / 담당자 / 우선순위 / 출처 / 단위업무 / 정렬
const GRID_TEMPLATE = "32px 18% 1fr 110px 8% 7% 8% 5%";

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
  cursor:              "pointer",
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
  border:       "1px solid transparent",
  background:   "var(--color-primary, #1976d2)",
  color:        "#fff",
  fontSize:     14,
  fontWeight:   600,
  cursor:       "pointer",
};

// 담당자 필터 세그먼트 토글 — 단위업무·과업 목록과 동일 패턴
const segmentGroupStyle: React.CSSProperties = {
  display:      "inline-flex",
  border:       "1px solid var(--color-border)",
  borderRadius: 6,
  overflow:     "hidden",
  background:   "var(--color-bg-card)",
};
const segmentBtnStyle = (active: boolean): React.CSSProperties => ({
  padding:    "7px 14px",
  fontSize:   13,
  fontWeight: active ? 600 : 400,
  border:     "none",
  background: active ? "var(--color-brand-subtle)" : "transparent",
  color:      active ? "var(--color-brand)" : "var(--color-text-secondary)",
  cursor:     "pointer",
  outline:    "none",
});

// 필터 바 — 기능 정의 목록과 동일 규격
const filterSelectStyle: React.CSSProperties = {
  padding:      "7px 32px 7px 12px",
  borderRadius: 6,
  border:       "1px solid var(--color-border)",
  fontSize:     13,
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  minWidth:     160,
  cursor:       "pointer",
  appearance:   "none",
  WebkitAppearance: "none",
  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
  backgroundRepeat:   "no-repeat",
  backgroundPosition: "right 10px center",
};

const filterInputStyle: React.CSSProperties = {
  padding:      "7px 12px",
  borderRadius: 6,
  border:       "1px solid var(--color-border)",
  fontSize:     13,
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  minWidth:     220,
  outline:      "none",
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
