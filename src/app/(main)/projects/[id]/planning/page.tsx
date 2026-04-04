"use client";

/**
 * PlanningTreePage — 기획 트리 (PID-00039)
 *
 * 역할:
 *   - 좌측: 과업 → 요구사항 → 사용자스토리 계층 트리 (FID-00126)
 *   - 좌측: 키워드 검색 + 하이라이트 (FID-00127)
 *   - 좌측: 항목 추가 (FID-00132) / 삭제 (FID-00129)
 *   - 우측: 선택 항목 상세 조회 + 인라인 편집 (FID-00130/131)
 *   - 드래그앤드롭 순서 변경 (FID-00128)
 */

import { Suspense, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import RichEditor from "@/components/ui/RichEditor";
import MarkdownEditor from "@/components/ui/MarkdownEditor";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type StoryNode = { storyId: string; displayId: string; name: string };

type ReqNode = {
  reqId:      string;
  displayId:  string;
  name:       string;
  priority:   string;
  source:     string;
  storyCount: number;
  stories:    StoryNode[];
};

type TaskNode = {
  taskId:       string;
  displayId:    string;
  name:         string;
  category:     string;
  reqCount:     number;
  requirements: ReqNode[];
};

type TreeData = {
  tasks:           TaskNode[];
  unclassifiedReqs: ReqNode[];
  totalTaskCount:  number;
  totalReqCount:   number;
  totalStoryCount: number;
};

type SelectedNode =
  | { type: "task";        id: string }
  | { type: "requirement"; id: string }
  | { type: "story";       id: string };

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function PlanningTreePage() {
  return (
    <Suspense fallback={null}>
      <PlanningTreePageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function PlanningTreePageInner() {
  const params      = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const projectId   = params.id;

  const [keyword,      setKeyword]      = useState("");
  const [selected,     setSelected]     = useState<SelectedNode | null>(null);
  const [collapsed,    setCollapsed]    = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<{ type: string; id: string; name: string } | null>(null);

  // ── 트리 데이터 조회 ────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ["planning-tree", projectId],
    queryFn:  () =>
      authFetch<{ data: TreeData }>(`/api/projects/${projectId}/planning/tree`)
        .then((r) => r.data),
  });

  const tree = data ?? { tasks: [], unclassifiedReqs: [], totalTaskCount: 0, totalReqCount: 0, totalStoryCount: 0 };

  // ── 접힘 토글 ───────────────────────────────────────────────────────────────
  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ── 키워드 매칭 ─────────────────────────────────────────────────────────────
  const kw = keyword.trim().toLowerCase();
  function matches(text: string) {
    return kw ? text.toLowerCase().includes(kw) : true;
  }
  function highlight(text: string) {
    if (!kw) return <>{text}</>;
    const idx = text.toLowerCase().indexOf(kw);
    if (idx < 0) return <>{text}</>;
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{ background: "#fff176", color: "#000", borderRadius: 2 }}>
          {text.slice(idx, idx + kw.length)}
        </mark>
        {text.slice(idx + kw.length)}
      </>
    );
  }

  // ── 과업 추가 뮤테이션 ──────────────────────────────────────────────────────
  const addTaskMutation = useMutation({
    mutationFn: () =>
      authFetch<{ data: { taskId: string } }>(`/api/projects/${projectId}/tasks`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name: "새 과업", category: "NEW_DEV" }),
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["planning-tree", projectId] });
      setSelected({ type: "task", id: res.data.taskId });
      toast.success("과업이 추가되었습니다.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 요구사항 추가 뮤테이션 ──────────────────────────────────────────────────
  const addReqMutation = useMutation({
    mutationFn: (taskId: string | null) =>
      authFetch<{ data: { requirementId: string } }>(`/api/projects/${projectId}/requirements`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          taskId:   taskId || "",
          name:     "새 요구사항",
          priority: "MEDIUM",
          source:   "ADD",
        }),
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["planning-tree", projectId] });
      setSelected({ type: "requirement", id: res.data.requirementId });
      toast.success("요구사항이 추가되었습니다.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 사용자스토리 추가 뮤테이션 ─────────────────────────────────────────────
  const addStoryMutation = useMutation({
    mutationFn: (reqId: string) =>
      authFetch<{ data: { storyId: string } }>(`/api/projects/${projectId}/user-stories`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          requirementId: reqId,
          name:          "새 사용자스토리",
          persona:       "",
          scenario:      "",
          acceptanceCriteria: [],
        }),
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["planning-tree", projectId] });
      setSelected({ type: "story", id: res.data.storyId });
      toast.success("사용자스토리가 추가되었습니다.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 삭제 뮤테이션 ───────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: ({ type, id }: { type: string; id: string }) => {
      const url =
        type === "task"        ? `/api/projects/${projectId}/tasks/${id}` :
        type === "requirement" ? `/api/projects/${projectId}/requirements/${id}` :
                                 `/api/projects/${projectId}/user-stories/${id}`;
      return authFetch(url, { method: "DELETE" });
    },
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      setDeleteTarget(null);
      if (selected && deleteTarget && selected.id === deleteTarget.id) setSelected(null);
      queryClient.invalidateQueries({ queryKey: ["planning-tree", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 정렬 뮤테이션 (FID-00128) ───────────────────────────────────────────────
  const sortTasksMutation = useMutation({
    mutationFn: (taskIds: string[]) =>
      authFetch(`/api/projects/${projectId}/tasks/sort`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ taskIds }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["planning-tree", projectId] }),
    onError:   (err: Error) => toast.error(err.message),
  });

  const sortReqsMutation = useMutation({
    mutationFn: (orders: { requirementId: string; sortOrder: number }[]) =>
      authFetch(`/api/projects/${projectId}/requirements/sort`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ orders }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["planning-tree", projectId] }),
    onError:   (err: Error) => toast.error(err.message),
  });

  const sortStoriesMutation = useMutation({
    mutationFn: (orders: { storyId: string; sortOrder: number }[]) =>
      authFetch(`/api/projects/${projectId}/user-stories/sort`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ orders }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["planning-tree", projectId] }),
    onError:   (err: Error) => toast.error(err.message),
  });

  // ── 과업 레벨 드래그 상태 ────────────────────────────────────────────────────
  const dragTaskItem     = useRef<number | null>(null);
  const dragTaskOverItem = useRef<number | null>(null);

  function handleTaskDragStart(fullIdx: number) {
    dragTaskItem.current = fullIdx;
  }
  function handleTaskDragEnter(fullIdx: number) {
    dragTaskOverItem.current = fullIdx;
  }
  function handleTaskDragEnd() {
    const from = dragTaskItem.current;
    const to   = dragTaskOverItem.current;
    if (from === null || to === null || from === to) return;

    const reordered = [...tree.tasks];
    const [moved]   = reordered.splice(from, 1);
    if (!moved) { dragTaskItem.current = null; dragTaskOverItem.current = null; return; }
    reordered.splice(to, 0, moved);

    sortTasksMutation.mutate(reordered.map((t) => t.taskId));
    dragTaskItem.current     = null;
    dragTaskOverItem.current = null;
  }

  // ── 노드 필터링 (키워드) ────────────────────────────────────────────────────
  function isTaskVisible(task: TaskNode) {
    if (!kw) return true;
    if (matches(task.name) || matches(task.displayId)) return true;
    return task.requirements.some((r) => isReqVisible(r));
  }
  function isReqVisible(req: ReqNode) {
    if (!kw) return true;
    if (matches(req.name) || matches(req.displayId)) return true;
    return req.stories.some((s) => matches(s.name) || matches(s.displayId));
  }

  if (isLoading) {
    return <div style={{ padding: "40px 32px", color: "#888" }}>로딩 중...</div>;
  }

  return (
    <div style={{ display: "flex", height: "calc(100vh - 48px)", overflow: "hidden", padding: "12px 16px 12px 16px", boxSizing: "border-box", background: "var(--color-bg-base, #f0f2f5)" }}>

      {/* ── 좌측 트리 패널 (AR-00057) ──────────────────────────────────────── */}
      <div style={{
        width:        340,
        minWidth:     260,
        borderRight:  "1px solid var(--color-border)",
        borderTop:    "1px solid var(--color-border)",
        borderLeft:   "1px solid var(--color-border)",
        borderRadius: "8px 0 0 8px",
        display:      "flex",
        flexDirection: "column",
        overflow:     "hidden",
        background:   "var(--color-bg-card)",
      }}>
        {/* 검색 + 과업 추가 */}
        <div style={{ padding: "12px 12px 10px", borderBottom: "1px solid var(--color-border)", display: "flex", gap: 8 }}>
          <input
            type="text"
            placeholder="🔍 검색..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{
              flex:         1,
              padding:      "6px 10px",
              borderRadius: 6,
              border:       "1px solid var(--color-border)",
              background:   "var(--color-bg-card)",
              color:        "var(--color-text-primary)",
              fontSize:     13,
            }}
          />
          <button
            onClick={() => addTaskMutation.mutate()}
            disabled={addTaskMutation.isPending}
            style={addBtnStyle}
            title="과업 추가"
          >
            + 과업
          </button>
        </div>

        {/* 통계 */}
        <div style={{ padding: "6px 12px", fontSize: 11, color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border)" }}>
          과업 {tree.totalTaskCount} · 요구사항 {tree.totalReqCount} · 스토리 {tree.totalStoryCount}
        </div>

        {/* 트리 본체 */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {/* 과업 노드들 */}
          {tree.tasks.filter(isTaskVisible).map((task) => {
            // 키워드 필터링 중에는 DnD 비활성화 (필터된 인덱스와 실제 인덱스 불일치 방지)
            const fullIdx = tree.tasks.findIndex((t) => t.taskId === task.taskId);
            return (
              <div
                key={task.taskId}
                draggable={!kw}
                onDragStart={() => handleTaskDragStart(fullIdx)}
                onDragEnter={() => handleTaskDragEnter(fullIdx)}
                onDragEnd={handleTaskDragEnd}
                onDragOver={(e) => e.preventDefault()}
              >
                <TaskTreeNode
                  task={task}
                  selected={selected}
                  collapsed={collapsed}
                  keyword={kw}
                  highlight={highlight}
                  isReqVisible={isReqVisible}
                  onSelect={setSelected}
                  onToggle={toggleCollapse}
                  onAddReq={(taskId) => addReqMutation.mutate(taskId)}
                  onAddStory={(reqId) => addStoryMutation.mutate(reqId)}
                  onDelete={setDeleteTarget}
                  onSortReqs={(orders) => sortReqsMutation.mutate(orders)}
                  onSortStories={(orders) => sortStoriesMutation.mutate(orders)}
                />
              </div>
            );
          })}

          {/* 미분류 요구사항 */}
          {tree.unclassifiedReqs.filter(isReqVisible).length > 0 && (
            <div>
              <div
                style={{
                  display:    "flex",
                  alignItems: "center",
                  padding:    "6px 12px",
                  fontSize:   12,
                  fontWeight: 600,
                  color:      "var(--color-text-secondary)",
                  gap:        6,
                  cursor:     "pointer",
                }}
                onClick={() => toggleCollapse("__unclassified__")}
              >
                <span>{collapsed.has("__unclassified__") ? "▶" : "▼"}</span>
                <span>📁 미분류</span>
                <span style={{
                  background:   "var(--color-brand-subtle, rgba(25,118,210,0.1))",
                  color:        "var(--color-primary, #1976d2)",
                  borderRadius: 10,
                  padding:      "1px 7px",
                  fontSize:     10,
                  fontWeight:   600,
                  marginLeft:   "auto",
                }}>
                  {tree.unclassifiedReqs.length}
                </span>
                <button
                  style={iconBtnStyle}
                  onClick={(e) => { e.stopPropagation(); addReqMutation.mutate(null); }}
                  title="요구사항 추가"
                >+</button>
              </div>
              {!collapsed.has("__unclassified__") &&
                tree.unclassifiedReqs.filter(isReqVisible).map((req) => (
                  <ReqTreeNode
                    key={req.reqId}
                    req={req}
                    depth={1}
                    selected={selected}
                    collapsed={collapsed}
                    keyword={kw}
                    highlight={highlight}
                    onSelect={setSelected}
                    onToggle={toggleCollapse}
                    onAddStory={(reqId) => addStoryMutation.mutate(reqId)}
                    onDelete={setDeleteTarget}
                    onSortStories={(orders) => sortStoriesMutation.mutate(orders)}
                  />
                ))
              }
            </div>
          )}

          {tree.tasks.length === 0 && tree.unclassifiedReqs.length === 0 && (
            <div style={{ padding: "40px 16px", textAlign: "center", color: "#aaa", fontSize: 13 }}>
              과업을 추가해 주세요.
            </div>
          )}
        </div>
      </div>

      {/* ── 우측 상세 패널 (AR-00058) ──────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: "auto", borderTop: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)", borderRadius: "0 8px 8px 0", background: "var(--color-bg-muted, #f5f6f8)" }}>
        {selected ? (
          <DetailPanel
            key={`${selected.type}-${selected.id}`}
            projectId={projectId}
            selected={selected}
            onSaved={() => queryClient.invalidateQueries({ queryKey: ["planning-tree", projectId] })}
          />
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#aaa", fontSize: 14 }}>
            좌측 트리에서 항목을 선택해 주세요.
          </div>
        )}
      </div>

      {/* 삭제 확인 다이얼로그 */}
      {deleteTarget && (
        <div style={overlayStyle} onClick={() => setDeleteTarget(null)}>
          <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>
              {deleteTarget.type === "task" ? "과업" : deleteTarget.type === "requirement" ? "요구사항" : "사용자스토리"}을 삭제하시겠습니까?
            </h3>
            <p style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600 }}>&lsquo;{deleteTarget.name}&rsquo;</p>
            <p style={{ margin: "0 0 24px", fontSize: 13, color: "#888" }}>
              {deleteTarget.type === "task"
                ? "과업과 하위 요구사항·스토리가 모두 삭제됩니다."
                : deleteTarget.type === "requirement"
                ? "요구사항과 하위 스토리가 모두 삭제됩니다."
                : "사용자스토리와 인수기준이 삭제됩니다."}
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setDeleteTarget(null)} style={secondaryBtnStyle} disabled={deleteMutation.isPending}>취소</button>
              <button
                onClick={() => deleteMutation.mutate({ type: deleteTarget.type, id: deleteTarget.id })}
                style={{ ...primaryBtnStyle, background: "#e53935" }}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 과업 트리 노드 ────────────────────────────────────────────────────────────

function TaskTreeNode({
  task, selected, collapsed, keyword, highlight, isReqVisible,
  onSelect, onToggle, onAddReq, onAddStory, onDelete, onSortReqs, onSortStories,
}: {
  task:          TaskNode;
  selected:      SelectedNode | null;
  collapsed:     Set<string>;
  keyword:       string;
  highlight:     (t: string) => React.ReactNode;
  isReqVisible:  (r: ReqNode) => boolean;
  onSelect:      (n: SelectedNode) => void;
  onToggle:      (id: string) => void;
  onAddReq:      (taskId: string) => void;
  onAddStory:    (reqId: string) => void;
  onDelete:      (t: { type: string; id: string; name: string }) => void;
  onSortReqs:    (orders: { requirementId: string; sortOrder: number }[]) => void;
  onSortStories: (orders: { storyId: string; sortOrder: number }[]) => void;
}) {
  const isOpen   = !collapsed.has(task.taskId);
  const isActive = selected?.type === "task" && selected.id === task.taskId;

  // ── 요구사항 레벨 드래그 상태 ──────────────────────────────────────────────
  const dragReqItem     = useRef<number | null>(null);
  const dragReqOverItem = useRef<number | null>(null);

  function handleReqDragEnd() {
    const from = dragReqItem.current;
    const to   = dragReqOverItem.current;
    if (from === null || to === null || from === to) return;

    const reordered = [...task.requirements];
    const [moved]   = reordered.splice(from, 1);
    if (!moved) { dragReqItem.current = null; dragReqOverItem.current = null; return; }
    reordered.splice(to, 0, moved);

    onSortReqs(reordered.map((r, idx) => ({ requirementId: r.reqId, sortOrder: idx + 1 })));
    dragReqItem.current     = null;
    dragReqOverItem.current = null;
  }

  return (
    <div>
      <TreeRow
        depth={0}
        icon="📁"
        displayId={task.displayId}
        name={task.name}
        highlight={highlight}
        badge={
          <span style={{
            background:   "var(--color-brand-subtle, rgba(25,118,210,0.1))",
            color:        "var(--color-primary, #1976d2)",
            borderRadius: 10,
            padding:      "1px 7px",
            fontSize:     10,
            fontWeight:   600,
          }}>
            {task.reqCount}
          </span>
        }
        isActive={isActive}
        isOpen={isOpen}
        onClick={() => onSelect({ type: "task", id: task.taskId })}
        onToggle={() => onToggle(task.taskId)}
        onAdd={() => onAddReq(task.taskId)}
        onDelete={() => onDelete({ type: "task", id: task.taskId, name: task.name })}
        addTitle="요구사항 추가"
      />
      {isOpen && task.requirements.filter(isReqVisible).map((req) => {
        // 키워드 필터링 중에는 DnD 비활성화
        const fullIdx = task.requirements.findIndex((r) => r.reqId === req.reqId);
        return (
          <div
            key={req.reqId}
            draggable={!keyword}
            onDragStart={() => { dragReqItem.current = fullIdx; }}
            onDragEnter={() => { dragReqOverItem.current = fullIdx; }}
            onDragEnd={handleReqDragEnd}
            onDragOver={(e) => e.preventDefault()}
          >
            <ReqTreeNode
              req={req}
              depth={1}
              selected={selected}
              collapsed={collapsed}
              keyword={keyword}
              highlight={highlight}
              onSelect={onSelect}
              onToggle={onToggle}
              onAddStory={onAddStory}
              onDelete={onDelete}
              onSortStories={onSortStories}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── 요구사항 트리 노드 ────────────────────────────────────────────────────────

function ReqTreeNode({
  req, depth, selected, collapsed, keyword, highlight,
  onSelect, onToggle, onAddStory, onDelete, onSortStories,
}: {
  req:           ReqNode;
  depth:         number;
  selected:      SelectedNode | null;
  collapsed:     Set<string>;
  keyword:       string;
  highlight:     (t: string) => React.ReactNode;
  onSelect:      (n: SelectedNode) => void;
  onToggle:      (id: string) => void;
  onAddStory:    (reqId: string) => void;
  onDelete:      (t: { type: string; id: string; name: string }) => void;
  onSortStories: (orders: { storyId: string; sortOrder: number }[]) => void;
}) {
  const isOpen   = !collapsed.has(req.reqId);
  const isActive = selected?.type === "requirement" && selected.id === req.reqId;

  const priorityColor =
    req.priority === "HIGH"   ? "#ef5350" :
    req.priority === "MEDIUM" ? "#ffa726" : "#66bb6a";

  // ── 스토리 레벨 드래그 상태 ────────────────────────────────────────────────
  const dragStoryItem     = useRef<number | null>(null);
  const dragStoryOverItem = useRef<number | null>(null);

  function handleStoryDragEnd() {
    const from = dragStoryItem.current;
    const to   = dragStoryOverItem.current;
    if (from === null || to === null || from === to) return;

    const reordered = [...req.stories];
    const [moved]   = reordered.splice(from, 1);
    if (!moved) { dragStoryItem.current = null; dragStoryOverItem.current = null; return; }
    reordered.splice(to, 0, moved);

    onSortStories(reordered.map((s, idx) => ({ storyId: s.storyId, sortOrder: idx + 1 })));
    dragStoryItem.current     = null;
    dragStoryOverItem.current = null;
  }

  const visibleStories = req.stories.filter(
    (s) => !keyword || s.name.toLowerCase().includes(keyword) || s.displayId.toLowerCase().includes(keyword)
  );

  return (
    <div>
      <TreeRow
        depth={depth}
        icon="📝"
        displayId={req.displayId}
        name={req.name}
        highlight={highlight}
        badge={<span style={{ width: 8, height: 8, borderRadius: "50%", background: priorityColor, display: "inline-block" }} />}
        isActive={isActive}
        isOpen={isOpen}
        hasChildren={req.storyCount > 0}
        onClick={() => onSelect({ type: "requirement", id: req.reqId })}
        onToggle={req.storyCount > 0 ? () => onToggle(req.reqId) : undefined}
        onAdd={() => onAddStory(req.reqId)}
        onDelete={() => onDelete({ type: "requirement", id: req.reqId, name: req.name })}
        addTitle="사용자스토리 추가"
      />
      {isOpen && visibleStories.map((story) => {
        const fullIdx = req.stories.findIndex((s) => s.storyId === story.storyId);
        return (
          <div
            key={story.storyId}
            draggable={!keyword}
            onDragStart={() => { dragStoryItem.current = fullIdx; }}
            onDragEnter={() => { dragStoryOverItem.current = fullIdx; }}
            onDragEnd={handleStoryDragEnd}
            onDragOver={(e) => e.preventDefault()}
          >
            <StoryTreeNode
              story={story}
              depth={depth + 1}
              selected={selected}
              highlight={highlight}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── 스토리 트리 노드 ──────────────────────────────────────────────────────────

function StoryTreeNode({
  story, depth, selected, highlight, onSelect, onDelete,
}: {
  story:     StoryNode;
  depth:     number;
  selected:  SelectedNode | null;
  highlight: (t: string) => React.ReactNode;
  onSelect:  (n: SelectedNode) => void;
  onDelete:  (t: { type: string; id: string; name: string }) => void;
}) {
  const isActive = selected?.type === "story" && selected.id === story.storyId;

  return (
    <TreeRow
      depth={depth}
      icon="👤"
      displayId={story.displayId}
      name={story.name}
      highlight={highlight}
      isActive={isActive}
      isOpen={false}
      hasChildren={false}
      onClick={() => onSelect({ type: "story", id: story.storyId })}
      onDelete={() => onDelete({ type: "story", id: story.storyId, name: story.name })}
      addTitle=""
    />
  );
}

// ── 공통 트리 행 컴포넌트 ─────────────────────────────────────────────────────

function TreeRow({
  depth, icon, displayId, name, highlight, badge,
  isActive, isOpen, hasChildren = true,
  onClick, onToggle, onAdd, onDelete, addTitle,
}: {
  depth:        number;
  icon:         string;
  displayId:    string;
  name:         string;
  highlight:    (t: string) => React.ReactNode;
  badge?:       React.ReactNode;
  isActive:     boolean;
  isOpen:       boolean;
  hasChildren?: boolean;
  onClick:      () => void;   // 선택만 (우측 패널)
  onToggle?:    () => void;   // 접힘/펼침만 (화살표 클릭)
  onAdd?:       () => void;
  onDelete:     () => void;
  addTitle:     string;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{
        display:         "flex",
        alignItems:      "center",
        paddingLeft:     `${depth * 14 + 8}px`,
        paddingRight:    10,
        paddingTop:      5,
        paddingBottom:   5,
        cursor:          "pointer",
        background:      isActive ? "var(--color-brand-subtle, rgba(25,118,210,0.12))" : hovered ? "var(--color-bg-muted)" : "transparent",
        borderLeft:      isActive ? "2px solid var(--color-primary, #1976d2)" : "2px solid transparent",
        gap:             6,
        userSelect:      "none",
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 드래그 핸들 — 호버 시에만 표시 */}
      <span
        style={{
          fontSize:   11,
          color:      hovered ? "var(--color-text-secondary)" : "transparent",
          width:      8,
          flexShrink: 0,
          cursor:     "grab",
          userSelect: "none",
        }}
        title="드래그하여 순서 변경"
      >
        ☰
      </span>

      {/* 펼침 화살표 — 클릭 시 접힘/펼침만, 선택 이벤트 차단 */}
      <span
        style={{ fontSize: 10, color: "#888", width: 10, flexShrink: 0 }}
        onClick={onToggle ? (e) => { e.stopPropagation(); onToggle(); } : undefined}
      >
        {hasChildren ? (isOpen ? "▼" : "▶") : ""}
      </span>

      {/* 아이콘 */}
      <span style={{ fontSize: 13, flexShrink: 0 }}>{icon}</span>

      {/* displayId + 명칭 + 배지 (이름 영역 안에 묶음) */}
      <span style={{ fontSize: 11, color: "#aaa", flexShrink: 0 }}>{displayId}</span>
      <span style={{
        flex:        1,
        display:     "flex",
        alignItems:  "center",
        gap:         5,
        overflow:    "hidden",
        minWidth:    0,
      }}>
        <span style={{
          fontSize:     13,
          color:        "var(--color-text-primary)",
          flex:         1,
          overflow:     "hidden",
          textOverflow: "ellipsis",
          whiteSpace:   "nowrap",
          fontWeight:   isActive ? 600 : 400,
        }}>
          {highlight(name)}
        </span>
        {/* 배지 — 이름 바로 옆, 우측 끝이 아닌 콘텐츠 영역 안 */}
        {badge && <span style={{ flexShrink: 0 }}>{badge}</span>}
      </span>

      {/* 호버 시 버튼 */}
      {(hovered || isActive) && (
        <div style={{ display: "flex", gap: 2, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
          {onAdd && addTitle && (
            <button onClick={onAdd} style={iconBtnStyle} title={addTitle}>+</button>
          )}
          <button onClick={onDelete} style={{ ...iconBtnStyle, color: "#e53935" }} title="삭제">×</button>
        </div>
      )}
    </div>
  );
}

// ── 우측 상세 편집 패널 ───────────────────────────────────────────────────────

function DetailPanel({
  projectId, selected, onSaved,
}: {
  projectId: string;
  selected:  SelectedNode;
  onSaved:   () => void;
}) {
  if (selected.type === "task") {
    return <TaskDetailPanel projectId={projectId} taskId={selected.id} onSaved={onSaved} />;
  }
  if (selected.type === "requirement") {
    return <ReqDetailPanel projectId={projectId} reqId={selected.id} onSaved={onSaved} />;
  }
  return <StoryDetailPanel projectId={projectId} storyId={selected.id} onSaved={onSaved} />;
}

// ── 과업 상세 패널 ────────────────────────────────────────────────────────────

function TaskDetailPanel({ projectId, taskId, onSaved }: { projectId: string; taskId: string; onSaved: () => void }) {
  const [name,       setName]       = useState("");
  const [category,   setCategory]   = useState("NEW_DEV");
  const [rfpPage,    setRfpPage]    = useState("");
  const [definition, setDefinition] = useState("");
  const [content,    setContent]    = useState("");
  const [outputInfo, setOutputInfo] = useState("");
  const [loaded,     setLoaded]     = useState(false);

  const { isLoading } = useQuery({
    queryKey: ["task-detail", projectId, taskId],
    queryFn:  () =>
      authFetch<{ data: { name: string; category: string; definition: string | null; content: string | null; outputInfo: string | null; rfpPage: string | null } }>(
        `/api/projects/${projectId}/tasks/${taskId}`
      ).then((r) => {
        setName(r.data.name);
        setCategory(r.data.category);
        setRfpPage(r.data.rfpPage ?? "");
        setDefinition(r.data.definition ?? "");
        setContent(r.data.content ?? "");
        setOutputInfo(r.data.outputInfo ?? "");
        setLoaded(true);
        return r.data;
      }),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/tasks/${taskId}`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name, category, rfpPage, definition, content, outputInfo }),
      }),
    onSuccess: () => { toast.success("저장되었습니다."); onSaved(); },
    onError:   (err: Error) => toast.error(err.message),
  });

  if (isLoading || !loaded) return <PanelLoading />;

  return (
    <div style={panelStyle}>
      <PanelHeader icon="📁" displayType="과업" name={name} onSave={() => saveMutation.mutate()} isPending={saveMutation.isPending} />
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <PanelField label="과업명 *">
          <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
        </PanelField>
        <div style={{ display: "flex", gap: 16 }}>
          <PanelField label="카테고리 *" style={{ flex: 1 }}>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
              <option value="NEW_DEV">신규개발</option>
              <option value="IMPROVE">기능 개선</option>
              <option value="MAINTAIN">유지 보수</option>
            </select>
          </PanelField>
          <PanelField label="RFP 페이지 번호" style={{ flex: 1 }}>
            <input value={rfpPage} onChange={(e) => setRfpPage(e.target.value)} placeholder="예: p.23" style={inputStyle} />
          </PanelField>
        </div>
        <PanelField label="정의">
          <textarea value={definition} onChange={(e) => setDefinition(e.target.value)} rows={4} style={{ ...inputStyle, resize: "vertical" }} />
        </PanelField>
        <PanelField label="세부내용">
          <RichEditor key={`task-content-${taskId}`} value={content} onChange={setContent} placeholder="세부 내용을 입력하세요." minHeight={200} />
        </PanelField>
        <PanelField label="산출물">
          <textarea value={outputInfo} onChange={(e) => setOutputInfo(e.target.value)} rows={4} style={{ ...inputStyle, resize: "vertical" }} />
        </PanelField>
      </div>
    </div>
  );
}

// ── 요구사항 상세 패널 ────────────────────────────────────────────────────────

function ReqDetailPanel({ projectId, reqId, onSaved }: { projectId: string; reqId: string; onSaved: () => void }) {
  const [name,        setName]        = useState("");
  const [priority,    setPriority]    = useState("MEDIUM");
  const [source,      setSource]      = useState("RFP");
  const [orgnlCn,     setOrgnlCn]     = useState("");
  const [curncyCn,    setCurncyCn]    = useState("");
  const [analysisCn,  setAnalysisCn]  = useState("");
  const [specCn,      setSpecCn]      = useState("");
  const [taskId,      setTaskId]      = useState<string | null>(null);
  const [loaded,      setLoaded]      = useState(false);
  // 원문/현행화 탭 — 현행화가 기본 활성
  const [contentTab,  setContentTab]  = useState<"current" | "original">("current");
  // 분석 메모 / 상세 명세 마크다운 탭
  const [analysisTab, setAnalysisTab] = useState<"edit" | "preview">("edit");
  const [specTab,     setSpecTab]     = useState<"edit" | "preview">("edit");
  // 기본 정보 섹션 접힘 — 기본적으로 접혀 있음
  const [basicOpen,   setBasicOpen]   = useState(false);

  const { isLoading } = useQuery({
    queryKey: ["req-detail-tree", projectId, reqId],
    queryFn:  () =>
      authFetch<{ data: { name: string; priority: string; source: string; originalContent: string; currentContent: string; analysisMemo: string; detailSpec: string; requirementId: string; taskId: string | null } }>(
        `/api/projects/${projectId}/requirements/${reqId}`
      ).then((r) => {
        setName(r.data.name);
        setPriority(r.data.priority);
        setSource(r.data.source);
        setOrgnlCn(r.data.originalContent);
        setCurncyCn(r.data.currentContent);
        setAnalysisCn(r.data.analysisMemo);
        setSpecCn(r.data.detailSpec);
        setTaskId(r.data.taskId ?? null);
        setLoaded(true);
        return r.data;
      }),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/requirements/${reqId}`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          requirementId: reqId,
          // taskId를 반드시 포함해야 과업 연결이 유지됨 (누락 시 null로 덮어써져 미분류 처리됨)
          taskId,
          name, priority, source,
          rfpPage:         "",
          originalContent: orgnlCn,
          currentContent:  curncyCn,
          analysisMemo:    analysisCn,
          detailSpec:      specCn,
        }),
      }),
    onSuccess: () => { toast.success("저장되었습니다."); onSaved(); },
    onError:   (err: Error) => toast.error(err.message),
  });

  if (isLoading || !loaded) return <PanelLoading />;

  return (
    <div style={panelStyle}>
      <PanelHeader icon="📝" displayType="요구사항" name={name} onSave={() => saveMutation.mutate()} isPending={saveMutation.isPending} />
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

        {/* 기본 정보 — 기본 접힘 */}
        <div>
          <button
            type="button"
            onClick={() => setBasicOpen((v) => !v)}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10,
              padding: "10px 0", background: "none", border: "none",
              borderBottom: "1px solid var(--color-border)",
              cursor: "pointer",
            }}
          >
            {/* 햄버거 아이콘 */}
            <span style={{ display: "flex", flexDirection: "column", gap: 3, flexShrink: 0, opacity: 0.5 }}>
              <span style={{ width: 14, height: 1.5, background: "var(--color-text-primary)", borderRadius: 2, display: "block" }} />
              <span style={{ width: 10, height: 1.5, background: "var(--color-text-primary)", borderRadius: 2, display: "block" }} />
              <span style={{ width: 12, height: 1.5, background: "var(--color-text-primary)", borderRadius: 2, display: "block" }} />
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", flex: 1, textAlign: "left" }}>
              기본 정보
            </span>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)", marginRight: 6 }}>
              요구사항명 · 우선순위 · 출처 · 내용
            </span>
            {/* 회전 chevron */}
            <span style={{
              fontSize:   18,
              color:      "var(--color-text-secondary)",
              transform:  basicOpen ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.18s ease",
              display:    "inline-block",
              lineHeight: 1,
            }}>›</span>
          </button>
          {basicOpen && (
            <div style={{ padding: "16px 0", display: "flex", flexDirection: "column", gap: 16 }}>
              <PanelField label="요구사항명 *">
                <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
              </PanelField>
              <div style={{ display: "flex", gap: 16 }}>
                <PanelField label="우선순위" style={{ flex: 1 }}>
                  <select value={priority} onChange={(e) => setPriority(e.target.value)} style={inputStyle}>
                    <option value="HIGH">높음 (HIGH)</option>
                    <option value="MEDIUM">중간 (MEDIUM)</option>
                    <option value="LOW">낮음 (LOW)</option>
                  </select>
                </PanelField>
                <PanelField label="출처" style={{ flex: 1 }}>
                  <select value={source} onChange={(e) => setSource(e.target.value)} style={inputStyle}>
                    <option value="RFP">RFP</option>
                    <option value="ADD">추가</option>
                    <option value="CHANGE">변경</option>
                  </select>
                </PanelField>
              </div>
              {/* 원문 / 현행화 탭 */}
              <div>
                <div style={{ display: "flex", borderBottom: "1px solid var(--color-border)", marginBottom: 12 }}>
                  {(["current", "original"] as const).map((tab) => {
                    const label = tab === "current" ? "현행화" : "원문";
                    const active = contentTab === tab;
                    return (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setContentTab(tab)}
                        style={{
                          padding: "6px 14px", fontSize: 13,
                          fontWeight: active ? 600 : 400,
                          color: active ? "var(--color-brand)" : "var(--color-text-secondary)",
                          background: "none", border: "none",
                          borderBottom: active ? "2px solid var(--color-brand)" : "2px solid transparent",
                          cursor: "pointer", marginBottom: -1,
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {contentTab === "current" ? (
                  <RichEditor key={`current-${reqId}`} value={curncyCn} onChange={setCurncyCn} placeholder="현행화 내용을 입력하세요." minHeight={160} />
                ) : (
                  <RichEditor key={`original-${reqId}`} value={orgnlCn} onChange={setOrgnlCn} placeholder="원문 내용을 입력하세요." minHeight={160} />
                )}
              </div>
            </div>
          )}
        </div>

        {/* 분석 메모 — 원문/마크다운 탭 */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)" }}>분석 메모</label>
            <div style={{ display: "flex", gap: 2 }}>
              {(["edit", "preview"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setAnalysisTab(t)} style={{
                  padding: "3px 10px", fontSize: 12, borderRadius: 4, cursor: "pointer",
                  background: analysisTab === t ? "var(--color-primary, #1976d2)" : "var(--color-bg-muted)",
                  color:      analysisTab === t ? "#fff" : "var(--color-text-secondary)",
                  border:     "1px solid var(--color-border)",
                  fontWeight: analysisTab === t ? 600 : 400,
                }}>
                  {t === "edit" ? "원문" : "마크다운"}
                </button>
              ))}
            </div>
          </div>
          <MarkdownEditor value={analysisCn} onChange={setAnalysisCn} rows={15} placeholder="분석 메모를 입력하세요." tab={analysisTab} onTabChange={setAnalysisTab} />
        </div>

        {/* 상세 명세 — 원문/마크다운 탭 */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)" }}>상세 명세</label>
            <div style={{ display: "flex", gap: 2 }}>
              {(["edit", "preview"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setSpecTab(t)} style={{
                  padding: "3px 10px", fontSize: 12, borderRadius: 4, cursor: "pointer",
                  background: specTab === t ? "var(--color-primary, #1976d2)" : "var(--color-bg-muted)",
                  color:      specTab === t ? "#fff" : "var(--color-text-secondary)",
                  border:     "1px solid var(--color-border)",
                  fontWeight: specTab === t ? 600 : 400,
                }}>
                  {t === "edit" ? "원문" : "마크다운"}
                </button>
              ))}
            </div>
          </div>
          <MarkdownEditor value={specCn} onChange={setSpecCn} rows={15} placeholder="상세 명세를 입력하세요." tab={specTab} onTabChange={setSpecTab} />
        </div>
      </div>
    </div>
  );
}

// ── 사용자스토리 상세 패널 ────────────────────────────────────────────────────

type AcRow = { acId?: string; given: string; when: string; then: string };

function StoryDetailPanel({ projectId, storyId, onSaved }: { projectId: string; storyId: string; onSaved: () => void }) {
  const [reqId,    setReqId]    = useState("");
  const [name,     setName]     = useState("");
  const [persona,  setPersona]  = useState("");
  const [scenario, setScenario] = useState("");
  const [acRows,   setAcRows]   = useState<AcRow[]>([]);
  const [loaded,   setLoaded]   = useState(false);

  const { isLoading } = useQuery({
    queryKey: ["story-detail-tree", projectId, storyId],
    queryFn:  () =>
      authFetch<{ data: { requirementId: string; name: string; persona: string; scenario: string; acceptanceCriteria: AcRow[] } }>(
        `/api/projects/${projectId}/user-stories/${storyId}`
      ).then((r) => {
        setReqId(r.data.requirementId);
        setName(r.data.name);
        setPersona(r.data.persona);
        setScenario(r.data.scenario);
        setAcRows(r.data.acceptanceCriteria.map((ac) => ({ acId: ac.acId as unknown as string, given: ac.given, when: ac.when, then: ac.then })));
        setLoaded(true);
        return r.data;
      }),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/user-stories/${storyId}`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ requirementId: reqId, name, persona, scenario, acceptanceCriteria: acRows }),
      }),
    onSuccess: () => { toast.success("저장되었습니다."); onSaved(); },
    onError:   (err: Error) => toast.error(err.message),
  });

  if (isLoading || !loaded) return <PanelLoading />;

  return (
    <div style={panelStyle}>
      <PanelHeader icon="👤" displayType="사용자스토리" name={name} onSave={() => saveMutation.mutate()} isPending={saveMutation.isPending} />
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <PanelField label="스토리명 *">
          <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
        </PanelField>
        <PanelField label="페르소나">
          <textarea value={persona} onChange={(e) => setPersona(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
        </PanelField>
        <PanelField label="시나리오">
          <textarea value={scenario} onChange={(e) => setScenario(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
        </PanelField>

        {/* 인수기준 */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: "var(--color-text-secondary)" }}>
            인수기준 (Given / When / Then)
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {acRows.map((row, idx) => (
              <div key={idx} style={{
                border:       "1px solid var(--color-border)",
                borderRadius: 8,
                padding:      "14px 14px 10px",
                background:   "var(--color-bg-muted)",
                position:     "relative",
              }}>
                {/* 순번 + 삭제 */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-secondary)" }}>
                    AC-{idx + 1}
                  </span>
                  <button
                    onClick={() => setAcRows(acRows.filter((_, i) => i !== idx))}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#e53935", fontSize: 18, lineHeight: 1, padding: "0 2px" }}
                    title="삭제"
                  >×</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  {(["given", "when", "then"] as const).map((field, fi) => {
                    const colors = ["#1565c0", "#2e7d32", "#6a1b9a"];
                    const labels = ["Given", "When", "Then"];
                    return (
                      <div key={field}>
                        <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 5, color: colors[fi] }}>
                          {labels[fi]}
                        </div>
                        <textarea
                          value={row[field]}
                          onChange={(e) => {
                            const updated = [...acRows];
                            updated[idx] = { ...updated[idx], [field]: e.target.value };
                            setAcRows(updated);
                          }}
                          rows={4}
                          style={{ ...inputStyle, resize: "vertical", fontSize: 13, lineHeight: 1.6 }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={() => setAcRows([...acRows, { given: "", when: "", then: "" }])}
            style={{ ...secondaryBtnStyle, fontSize: 12, padding: "6px 14px", marginTop: 10 }}
          >
            + 인수기준 추가
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 공통 서브 컴포넌트 ────────────────────────────────────────────────────────

function PanelLoading() {
  return <div style={{ padding: 32, color: "#888" }}>로딩 중...</div>;
}

function PanelHeader({ icon, displayType, name, onSave, isPending }: {
  icon:        string;
  displayType: string;
  name:        string;
  onSave?:     () => void;
  isPending?:  boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
      <div>
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4 }}>{icon} {displayType}</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "var(--color-text-primary)" }}>{name || "(이름 없음)"}</div>
      </div>
      {onSave && (
        <button onClick={onSave} disabled={isPending} style={{ ...primaryBtnStyle, marginTop: 4 }}>
          {isPending ? "저장 중..." : "저장"}
        </button>
      )}
    </div>
  );
}

function PanelField({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={style}>
      <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6, color: "var(--color-text-secondary)" }}>{label}</label>
      {children}
    </div>
  );
}

function SaveBar({ onSave, isPending }: { onSave: () => void; isPending: boolean }) {
  return (
    <div style={{ marginTop: 32, paddingTop: 16, borderTop: "1px solid var(--color-border)", display: "flex", justifyContent: "flex-end" }}>
      <button onClick={onSave} disabled={isPending} style={primaryBtnStyle}>
        {isPending ? "저장 중..." : "저장"}
      </button>
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  padding:   "28px 32px",
  maxWidth:  720,
};

const inputStyle: React.CSSProperties = {
  width:        "100%",
  padding:      "8px 12px",
  borderRadius: 6,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     14,
  boxSizing:    "border-box",
};

const primaryBtnStyle: React.CSSProperties = {
  padding:      "5px 14px",
  borderRadius: 6,
  border:       "none",
  background:   "var(--color-primary, #1976d2)",
  color:        "#fff",
  fontSize:     13,
  fontWeight:   600,
  cursor:       "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding:      "7px 16px",
  borderRadius: 6,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     13,
  cursor:       "pointer",
};

const addBtnStyle: React.CSSProperties = {
  padding:      "5px 10px",
  borderRadius: 5,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     12,
  cursor:       "pointer",
  whiteSpace:   "nowrap",
};

const iconBtnStyle: React.CSSProperties = {
  width:        18,
  height:       18,
  borderRadius: 3,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-secondary)",
  fontSize:     12,
  cursor:       "pointer",
  display:      "flex",
  alignItems:   "center",
  justifyContent: "center",
  padding:      0,
  lineHeight:   1,
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
  minWidth:     360,
  maxWidth:     440,
  boxShadow:    "0 8px 32px rgba(0,0,0,0.18)",
};
