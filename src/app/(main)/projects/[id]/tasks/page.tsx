"use client";

/**
 * TaskListPage — 과업 목록 (PID-00028)
 *
 * 역할:
 *   - 과업 목록 조회 (FID-00092)
 *   - HTML5 드래그앤드롭으로 순서 조정 (FID-00093)
 *   - 복사 (FID-00094)
 *   - 삭제 모달 + ALL/TASK_ONLY 옵션 (FID-00095)
 */

import { Suspense, useState, useEffect, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type PrioritySummary = { high: number; medium: number; low: number };

type Task = {
  taskId:           string;
  displayId:        string;
  name:             string;
  category:         string;
  rfpPageNo:        string;
  outputInfo:       string;
  // 담당자 — 서버 join으로 내려옴. 미지정/퇴장 멤버면 null
  assignMemberId:   string | null;
  assignMemberName: string | null;
  requirementCount: number;
  prioritySummary:  PrioritySummary;
  sortOrder:        number;
};

type TasksResponse = { tasks: Task[]; totalCount: number };

// ── 상수 ─────────────────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<string, string> = {
  NEW_DEV:  "신규개발",
  IMPROVE:  "기능개선",
  MAINTAIN: "유지보수",
};

const CATEGORY_COLOR: Record<string, { bg: string; color: string }> = {
  NEW_DEV:  { bg: "#e3f2fd", color: "#1565c0" },
  IMPROVE:  { bg: "#e8f5e9", color: "#2e7d32" },
  MAINTAIN: { bg: "#fff3e0", color: "#e65100" },
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function TaskListPage() {
  return (
    <Suspense fallback={null}>
      <TaskListPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function TaskListPageInner() {
  const params      = useParams<{ id: string }>();
  const router      = useRouter();
  const projectId   = params.id;
  const queryClient = useQueryClient();

  // 담당자 필터 — 전역 appStore.myAssigneeMode 구독 (GNB 토글과 양방향 바인딩)
  const searchParams     = useSearchParams();
  const filterAssignedTo = useAppStore((s) => s.myAssigneeMode);
  const setMyAssigneeMode   = useAppStore((s) => s.setMyAssigneeMode);
  const hasLoadedProfile    = useAppStore((s) => s._hasLoadedProfile);
  // 페이지 세그먼트 토글 클릭 → 전역 state + DB 저장 + 실패 시 롤백
  function setFilterAssignedTo(next: "all" | "me") {
    const prev = filterAssignedTo;
    setMyAssigneeMode(next);
    authFetch("/api/member/profile/assignee-view", {
      method: "PATCH",
      body:   JSON.stringify({ mode: next }),
    }).catch((err: Error) => {
      setMyAssigneeMode(prev);
      toast.error("설정 저장 실패: " + err.message);
    });
  }

  // 담당자 드롭다운 — 특정 멤버 필터. "" = 담당자 전체
  // 드롭다운이 우선(구체적 필터), 드롭다운이 빈값일 때만 세그먼트(전역 모드) 반영
  const [filterMember, setFilterMember] = useState<string>("");

  // 프로젝트 멤버 목록 — 담당자 드롭다운 옵션용
  const { data: memberData } = useQuery({
    queryKey: ["project-members", projectId],
    queryFn:  () =>
      authFetch<{ data: { members: Array<{ memberId: string; name: string | null; email: string }> } }>(
        `/api/projects/${projectId}/members`
      ).then((r) => r.data),
    staleTime: 60 * 1000,
  });
  const members = memberData?.members ?? [];

  // 실제 서버로 보낼 assignedTo 값:
  //   - 드롭다운 특정 멤버 선택 → 그 mberId (구체적 필터 우선)
  //   - 드롭다운 "담당자 전체" + 세그먼트 "내 담당" → "me"
  //   - 그 외 → undefined
  const effectiveAssignedTo = filterMember || (filterAssignedTo === "me" ? "me" : "");

  // 로컬 순서 — 드래그 중 즉시 반영용
  const [orderedTasks, setOrderedTasks] = useState<Task[]>([]);
  const [deletingTask, setDeletingTask] = useState<Task | null>(null);
  const dragItem    = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  // "내 담당" 필터 URL 동기화 — 공유 URL 복원 가능
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (filterAssignedTo === "me") url.searchParams.set("assignedTo", "me");
    else url.searchParams.delete("assignedTo");
    window.history.replaceState(null, "", url.toString());
  }, [filterAssignedTo]);

  // URL ?assignedTo=me 로 진입한 경우 — 프로필 로드 후 전역 state에도 반영(DB 저장)
  useEffect(() => {
    if (!hasLoadedProfile) return;
    if (searchParams.get("assignedTo") === "me" && filterAssignedTo !== "me") {
      setFilterAssignedTo("me");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLoadedProfile]);

  // ── 목록 조회 ──────────────────────────────────────────────────────────────
  // 프로필 로드 전에는 쿼리 지연 → 첫 렌더 플리커 방지
  const { data, isLoading, error } = useQuery({
    queryKey: ["tasks", projectId, effectiveAssignedTo],
    queryFn:  () => {
      const qs = effectiveAssignedTo ? `?assignedTo=${encodeURIComponent(effectiveAssignedTo)}` : "";
      return authFetch<{ data: TasksResponse }>(`/api/projects/${projectId}/tasks${qs}`)
        .then((r) => {
          setOrderedTasks(r.data.tasks);
          return r.data;
        });
    },
    enabled: hasLoadedProfile,
  });

  // ── 복사 ───────────────────────────────────────────────────────────────────
  const copyMutation = useMutation({
    mutationFn: (taskId: string) =>
      authFetch(`/api/projects/${projectId}/tasks/${taskId}/copy`, { method: "POST" }),
    onSuccess: () => {
      toast.success("복사되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 삭제 ───────────────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: ({ taskId, deleteType }: { taskId: string; deleteType: string }) =>
      authFetch(
        `/api/projects/${projectId}/tasks/${taskId}?deleteType=${deleteType}`,
        { method: "DELETE" }
      ),
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      setDeletingTask(null);
      queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 순서 저장 ──────────────────────────────────────────────────────────────
  const sortMutation = useMutation({
    mutationFn: (taskIds: string[]) =>
      authFetch(`/api/projects/${projectId}/tasks/sort`, {
        method: "PUT",
        body: JSON.stringify({ taskIds }),
      }),
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 드래그앤드롭 핸들러 ────────────────────────────────────────────────────
  function handleDragStart(idx: number) {
    dragItem.current = idx;
  }
  function handleDragEnter(idx: number) {
    dragOverItem.current = idx;
    if (dragItem.current === null || dragItem.current === idx) return;

    const copy = [...orderedTasks];
    const [moved] = copy.splice(dragItem.current, 1);
    if (!moved) return;
    copy.splice(idx, 0, moved);
    dragItem.current = idx;
    setOrderedTasks(copy);
  }
  function handleDragEnd() {
    if (dragItem.current !== null) {
      sortMutation.mutate(orderedTasks.map((t) => t.taskId));
    }
    dragItem.current = null;
    dragOverItem.current = null;
  }

  // ── 렌더링 ─────────────────────────────────────────────────────────────────
  if (isLoading) {
    return <div style={{ padding: "40px 32px", color: "#888" }}>로딩 중...</div>;
  }
  
  // 에러 발생 시 빈 목록처럼 처리하되 안내 문구만 다르게 (사용자 요청: 심플하게)
  const isError = !!error;
  const tasks = isError ? [] : (orderedTasks.length > 0 ? orderedTasks : data?.tasks ?? []);
  const totalCount = isError ? 0 : data?.totalCount ?? 0;

  return (
    <div style={{ padding: 0 }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)", marginBottom: 16 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
          과업 목록
        </div>
        <button
          onClick={() => router.push(`/projects/${projectId}/tasks/new`)}
          style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 14px" }}
        >
          + 과업 추가
        </button>
      </div>

      <div style={{ padding: "0 24px 24px" }}>
      {/* 총 건수 + 담당자 필터 */}
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
          총 <strong>{totalCount}</strong>건
        </span>
        <div style={{ flex: 1 }} />
        {/* 담당자 드롭다운 — 특정 멤버 필터 (드롭다운이 우선, 세그먼트와 공존) */}
        <select
          value={filterMember}
          onChange={(e) => setFilterMember(e.target.value)}
          style={filterSelectStyle}
        >
          <option value="">담당자 전체</option>
          {members.map((m) => (
            <option key={m.memberId} value={m.memberId}>
              {m.name ?? m.email}
            </option>
          ))}
        </select>
        {/* 담당자 세그먼트 토글 — [전체 | 내 담당] */}
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
      </div>

      {/* 테이블 */}
      <div style={{
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        overflow: "hidden",
      }}>
        {/* 헤더 — 담당자 컬럼 추가 (과업명 뒤) */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "32px 1fr 110px 10% 80px 1.2fr 8% 12%",
          padding: "10px 16px",
          background: "var(--color-bg-muted)",
          borderBottom: "1px solid var(--color-border)",
          fontSize: 12, fontWeight: 600,
          color: "var(--color-text-secondary)",
          gap: 12,
          alignItems: "center",
        }}>
          <span />
          <span>과업명</span>
          <span>담당자</span>
          <span style={{ textAlign: "center" }}>카테고리</span>
          <span style={{ textAlign: "center" }}>RFP 페이지</span>
          <span>산출물</span>
          <span>요구사항</span>
          <span>H/M/L</span>
        </div>

        {/* 바디 */}
        {tasks.length === 0 ? (
          <div style={{ padding: "64px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
            {isError ? "접근 권한이 없거나 프로젝트 정보를 찾을 수 없습니다." : "등록된 과업이 없습니다."}
          </div>
        ) : (
          tasks.map((task, idx) => {
            const cc = CATEGORY_COLOR[task.category] ?? { bg: "#f5f5f5", color: "#666" };
            return (
              <div
                key={task.taskId}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragEnter={() => handleDragEnter(idx)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => router.push(`/projects/${projectId}/tasks/${task.taskId}`)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "32px 1fr 110px 10% 80px 1.2fr 8% 12%",
                  padding: "12px 16px",
                  borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                  alignItems: "center",
                  gap: 12,
                  cursor: "pointer",
                  background: "var(--color-bg-card)",
                  transition: "background 0.1s",
                }}
              >
                {/* 드래그 핸들 */}
                <span
                  onClick={(e) => e.stopPropagation()}
                  style={{ color: "#bbb", fontSize: 16, cursor: "grab", userSelect: "none" }}
                >
                  ≡
                </span>

                {/* 과업명 */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "#aaa", whiteSpace: "nowrap" }}>
                    {task.displayId}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)" }}>
                    {task.name}
                  </span>
                </div>

                {/* 담당자 — 미지정/퇴장 멤버는 흐린 "-" */}
                <div
                  style={{
                    fontSize: 13,
                    color: task.assignMemberName
                      ? "var(--color-text-primary)"
                      : "var(--color-text-tertiary)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                  title={task.assignMemberName ?? undefined}
                >
                  {task.assignMemberName ?? "-"}
                </div>

                {/* 카테고리 뱃지 */}
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <span style={{
                    display: "inline-block", padding: "3px 10px",
                    borderRadius: 20, fontSize: 11, fontWeight: 600,
                    background: cc.bg, color: cc.color,
                  }}>
                    {CATEGORY_LABEL[task.category] ?? task.category}
                  </span>
                </div>

                {/* RFP 페이지 */}
                <span style={{ fontSize: 12, color: "var(--color-text-secondary)", textAlign: "center" }}>
                  {task.rfpPageNo || <span style={{ color: "#ccc" }}>—</span>}
                </span>

                {/* 산출물 */}
                <span
                  style={{
                    fontSize: 12, color: "var(--color-text-secondary)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                  title={task.outputInfo || ""}
                >
                  {task.outputInfo || <span style={{ color: "#ccc" }}>—</span>}
                </span>

                {/* 요구사항 건수 */}
                <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                  {task.requirementCount}건
                </span>

                {/* HIGH/MED/LOW */}
                <span style={{ fontSize: 12, color: "#666" }}>
                  <span style={{ color: "#e53935" }}>{task.prioritySummary.high}</span>
                  {" / "}
                  <span style={{ color: "#fb8c00" }}>{task.prioritySummary.medium}</span>
                  {" / "}
                  <span style={{ color: "#43a047" }}>{task.prioritySummary.low}</span>
                </span>

              </div>
            );
          })
        )}
      </div>

      {/* 삭제 모달 */}
      {deletingTask && (
        <DeleteTaskDialog
          task={deletingTask}
          isPending={deleteMutation.isPending}
          onConfirm={(deleteType) =>
            deleteMutation.mutate({ taskId: deletingTask.taskId, deleteType })
          }
          onClose={() => setDeletingTask(null)}
        />
      )}
      </div>
    </div>
  );
}

// ── 삭제 모달 (FID-00095) ────────────────────────────────────────────────────

function DeleteTaskDialog({
  task, isPending, onConfirm, onClose,
}: {
  task:       Task;
  isPending:  boolean;
  onConfirm:  (deleteType: string) => void;
  onClose:    () => void;
}) {
  const [deleteType, setDeleteType] = useState<"ALL" | "TASK_ONLY">("ALL");
  const hasReqs = task.requirementCount > 0;

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000,
    }}>
      <div style={{
        background: "var(--color-bg-card)",
        borderRadius: "var(--radius-lg)",
        padding: "28px 32px",
        width: 440,
        maxWidth: "90vw",
        boxShadow: "0 8px 32px rgba(0,0,0,0.24)",
      }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>
          과업을 삭제하시겠습니까?
        </h2>
        <p style={{ margin: "0 0 20px", fontSize: 14, color: "#666" }}>
          <strong>{task.name}</strong>{" "}
          <span style={{ color: "#aaa", fontSize: 12 }}>({task.displayId})</span>
        </p>

        {hasReqs ? (
          <div style={{ marginBottom: 20 }}>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "#555" }}>
              하위 요구사항 {task.requirementCount}건이 있습니다. 삭제 방식을 선택해 주세요.
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, cursor: "pointer" }}>
              <input
                type="radio" name="deleteType" value="ALL"
                checked={deleteType === "ALL"}
                onChange={() => setDeleteType("ALL")}
              />
              <span style={{ fontSize: 14 }}>
                <strong>전체 삭제</strong>{" "}
                <span style={{ color: "#888", fontSize: 12 }}>(과업 + 하위 요구사항·스토리·인수기준 전체)</span>
              </span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="radio" name="deleteType" value="TASK_ONLY"
                checked={deleteType === "TASK_ONLY"}
                onChange={() => setDeleteType("TASK_ONLY")}
              />
              <span style={{ fontSize: 14 }}>
                <strong>과업만 삭제</strong>{" "}
                <span style={{ color: "#888", fontSize: 12 }}>(하위 요구사항은 미분류로 유지)</span>
              </span>
            </label>
          </div>
        ) : (
          <p style={{ margin: "0 0 20px", fontSize: 13, color: "#666" }}>
            하위 요구사항이 없습니다. 과업이 즉시 삭제됩니다.
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} disabled={isPending} style={secondaryBtnStyle}>
            취소
          </button>
          <button
            onClick={() => onConfirm(deleteType)}
            disabled={isPending}
            style={dangerBtnStyle}
          >
            {isPending ? "삭제 중..." : "삭제 확인"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 버튼 스타일 ──────────────────────────────────────────────────────────────

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 18px",
  borderRadius: 6,
  border: "1px solid transparent",
  background: "var(--color-primary, #1976d2)",
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

// 담당자 필터 드롭다운 — 다른 목록과 동일 톤
const filterSelectStyle: React.CSSProperties = {
  padding:            "7px 32px 7px 12px",
  borderRadius:       6,
  border:             "1px solid var(--color-border)",
  fontSize:           13,
  background:         "var(--color-bg-card)",
  color:              "var(--color-text-primary)",
  cursor:             "pointer",
  outline:            "none",
  appearance:         "none",
  WebkitAppearance:   "none",
  backgroundImage:    `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
  backgroundRepeat:   "no-repeat",
  backgroundPosition: "right 10px center",
  minWidth:           140,
};

// 담당자 필터 세그먼트 토글 — 단위업무 목록과 동일 패턴
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

const secondaryBtnStyle: React.CSSProperties = {
  padding: "7px 18px",
  borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 13,
  cursor: "pointer",
};

const dangerBtnStyle: React.CSSProperties = {
  padding: "7px 18px",
  borderRadius: 6,
  border: "1px solid #ef5350",
  background: "#fff5f5",
  color: "#e53935",
  fontSize: 13,
  cursor: "pointer",
};

const secondarySmallBtnStyle: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 5,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 11,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const dangerSmallBtnStyle: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 5,
  border: "1px solid #ef5350",
  background: "#fff5f5",
  color: "#e53935",
  fontSize: 11,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
