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

import { Suspense, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type PrioritySummary = { high: number; medium: number; low: number };

type Task = {
  taskId:           string;
  displayId:        string;
  name:             string;
  category:         string;
  requirementCount: number;
  prioritySummary:  PrioritySummary;
  progressRate:     number;
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

  // 로컬 순서 — 드래그 중 즉시 반영용
  const [orderedTasks, setOrderedTasks] = useState<Task[]>([]);
  const [deletingTask, setDeletingTask] = useState<Task | null>(null);
  const dragItem    = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  // ── 목록 조회 ──────────────────────────────────────────────────────────────
  const { data, isLoading, error } = useQuery({
    queryKey: ["tasks", projectId],
    queryFn:  () =>
      authFetch<{ data: TasksResponse }>(`/api/projects/${projectId}/tasks`)
        .then((r) => {
          setOrderedTasks(r.data.tasks);
          return r.data;
        }),
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
      {/* 총 건수 */}
      <div style={{ marginBottom: 16, fontSize: 14, color: "var(--color-text-secondary)" }}>
        총 <strong>{totalCount}</strong>건
      </div>

      {/* 테이블 */}
      <div style={{
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        overflow: "hidden",
      }}>
        {/* 헤더 */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "32px 1fr 10% 8% 12% 8%",
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
          <span style={{ textAlign: "center" }}>카테고리</span>
          <span>요구사항</span>
          <span>H/M/L</span>
          <span>진행률</span>
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
                  gridTemplateColumns: "32px 1fr 10% 8% 12% 8%",
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

                {/* 진행률 */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{
                    flex: 1,
                    height: 6, borderRadius: 3,
                    background: "#e0e0e0", overflow: "hidden",
                  }}>
                    <div style={{
                      height: "100%",
                      width: `${task.progressRate}%`,
                      background: "#1976d2",
                      borderRadius: 3,
                    }} />
                  </div>
                  <span style={{ fontSize: 11, color: "#888", minWidth: 24, textAlign: "right" }}>
                    {task.progressRate}%
                  </span>
                </div>

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
