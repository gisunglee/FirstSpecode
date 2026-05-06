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
import dynamic from "next/dynamic";
// TipTap 번들이 초기 로드에 포함되지 않도록 dynamic import
const RichEditor = dynamic(() => import("@/components/ui/RichEditor"), { ssr: false });
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
  | { type: "task";        id: string; displayId: string }
  | { type: "requirement"; id: string; displayId: string }
  | { type: "story";       id: string; displayId: string };

// ── displayId 축약 (SFR-00002 → T-2, REQ-00024 → R-24, STR-00002 → S-2) ──
function shortId(displayId: string) {
  const prefixMap: Record<string, string> = { SFR: "T", REQ: "R", STR: "S" };
  const match = displayId.match(/^([A-Z]+)-(\d+)$/);
  if (!match) return displayId;
  const prefix = prefixMap[match[1]] ?? match[1][0];
  const num    = parseInt(match[2], 10); // 앞의 0 제거
  return `${prefix}-${num}`;
}

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
      setSelected({ type: "task", id: res.data.taskId, displayId: "" });
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
      setSelected({ type: "requirement", id: res.data.requirementId, displayId: "" });
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
      setSelected({ type: "story", id: res.data.storyId, displayId: "" });
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
    <div style={{ display: "flex", height: "calc(100vh - 48px)", overflow: "hidden", padding: "12px 16px 12px 16px", boxSizing: "border-box", background: "var(--color-bg-content)" }}>

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
      <div style={{ flex: 1, overflow: "auto", borderTop: "1px solid var(--color-border)", borderRight: "1px solid var(--color-border)", borderBottom: "1px solid var(--color-border)", borderRadius: "0 8px 8px 0", background: "var(--color-bg-card)" }}>
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
        displayId={shortId(task.displayId)}
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
        onClick={() => onSelect({ type: "task", id: task.taskId, displayId: task.displayId })}
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
        displayId={shortId(req.displayId)}
        name={req.name}
        highlight={highlight}
        badge={<span style={{ width: 8, height: 8, borderRadius: "50%", background: priorityColor, display: "inline-block" }} />}
        isActive={isActive}
        isOpen={isOpen}
        hasChildren={req.storyCount > 0}
        onClick={() => onSelect({ type: "requirement", id: req.reqId, displayId: req.displayId })}
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
      displayId={shortId(story.displayId)}
      name={story.name}
      highlight={highlight}
      isActive={isActive}
      isOpen={false}
      hasChildren={false}
      onClick={() => onSelect({ type: "story", id: story.storyId, displayId: story.displayId })}
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
        paddingRight:    16,
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
    return <TaskDetailPanel projectId={projectId} taskId={selected.id} displayId={selected.displayId} onSaved={onSaved} />;
  }
  if (selected.type === "requirement") {
    return <ReqDetailPanel projectId={projectId} reqId={selected.id} displayId={selected.displayId} onSaved={onSaved} />;
  }
  return <StoryDetailPanel projectId={projectId} storyId={selected.id} displayId={selected.displayId} onSaved={onSaved} />;
}

// ── 과업 상세 패널 ────────────────────────────────────────────────────────────

function TaskDetailPanel({ projectId, taskId, displayId, onSaved }: { projectId: string; taskId: string; displayId: string; onSaved: () => void }) {
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
      <PanelHeader icon="📁" displayType="과업" displayId={displayId} name={name} onSave={() => saveMutation.mutate()} isPending={saveMutation.isPending} />
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
          <RichEditor key={`task-content-${taskId}`} value={content} onChange={setContent} placeholder="세부 내용을 입력하세요." minHeight={260} />
        </PanelField>
        <PanelField label="산출물">
          <textarea value={outputInfo} onChange={(e) => setOutputInfo(e.target.value)} rows={4} style={{ ...inputStyle, resize: "vertical" }} />
        </PanelField>
      </div>
    </div>
  );
}

// ── 요구사항 상세 패널 ────────────────────────────────────────────────────────

function ReqDetailPanel({ projectId, reqId, displayId, onSaved }: { projectId: string; reqId: string; displayId: string; onSaved: () => void }) {
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
  // 분석 메모 / 상세 명세 전환 탭
  const [reqContentTab, setReqContentTab] = useState<"analysis" | "spec">("analysis");
  // 마크다운 편집/미리보기 탭
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
      <PanelHeader icon="📝" displayType="요구사항" displayId={displayId} name={name} onSave={() => saveMutation.mutate()} isPending={saveMutation.isPending} />
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

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

        {/* 분석 메모 / 상세 명세 — 탭 전환 */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          {/* 탭 헤더 */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--color-border)", marginBottom: 12 }}>
            <div style={{ display: "flex" }}>
              {(["analysis", "spec"] as const).map((tab) => {
                const label = tab === "analysis" ? "분석 메모" : "상세 명세";
                const active = reqContentTab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setReqContentTab(tab)}
                    style={{
                      padding: "8px 18px", fontSize: 13,
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
            {/* 편집/미리보기 전환 버튼 */}
            <div style={{ display: "flex", gap: 2, marginBottom: 4 }}>
              {(["edit", "preview"] as const).map((t) => {
                const currentMdTab = reqContentTab === "analysis" ? analysisTab : specTab;
                return (
                  <button key={t} type="button" onClick={() => reqContentTab === "analysis" ? setAnalysisTab(t) : setSpecTab(t)} style={{
                    padding: "3px 10px", fontSize: 12, borderRadius: 4, cursor: "pointer",
                    background: currentMdTab === t ? "var(--color-primary, #1976d2)" : "var(--color-bg-muted)",
                    color:      currentMdTab === t ? "#fff" : "var(--color-text-secondary)",
                    border:     "1px solid var(--color-border)",
                    fontWeight: currentMdTab === t ? 600 : 400,
                  }}>
                    {t === "edit" ? "편집" : "미리보기"}
                  </button>
                );
              })}
            </div>
          </div>
          {/* 탭 콘텐츠 */}
          {reqContentTab === "analysis" ? (
            <MarkdownEditor value={analysisCn} onChange={setAnalysisCn} rows={32} placeholder="분석 메모를 입력하세요." tab={analysisTab} onTabChange={setAnalysisTab} />
          ) : (
            <MarkdownEditor value={specCn} onChange={setSpecCn} rows={32} placeholder="상세 명세를 입력하세요." tab={specTab} onTabChange={setSpecTab} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── 사용자스토리 상세 패널 ────────────────────────────────────────────────────

type AcRow = { acId?: string; given: string; when: string; then: string };

function StoryDetailPanel({ projectId, storyId, displayId, onSaved }: { projectId: string; storyId: string; displayId: string; onSaved: () => void }) {
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

  // 인수기준 행 수정 헬퍼
  const updateAc = (idx: number, field: "given" | "when" | "then", value: string) => {
    const updated = [...acRows];
    updated[idx] = { ...updated[idx], [field]: value };
    setAcRows(updated);
  };

  return (
    <div style={panelStyle}>
      {/* 헤더 — 저장 + 작성 가이드를 함께 배치 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
          <span style={{ fontSize: 13, flexShrink: 0 }}>👤</span>
          <span style={{ fontSize: 11, color: "var(--color-text-secondary)", flexShrink: 0 }}>사용자스토리</span>
          {displayId && <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--color-text-secondary)", opacity: 0.6, flexShrink: 0 }}>{displayId}</span>}
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name || "(이름 없음)"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <StoryGuide />
          <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} style={{ ...primaryBtnStyle, flexShrink: 0 }}>
            {saveMutation.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* 스토리명 */}
        <PanelField label="스토리명 *">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="스토리명을 입력하세요" style={inputStyle} />
        </PanelField>

        {/* 페르소나 / 시나리오 — 2행 */}
        <PanelField label="페르소나">
          <input value={persona} onChange={(e) => setPersona(e.target.value)} placeholder="예: 일반 회원 (신규 및 기존)" style={inputStyle} />
        </PanelField>
        <PanelField label="시나리오">
          <textarea value={scenario} onChange={(e) => setScenario(e.target.value)} placeholder="사용자의 행동 흐름을 자연어로 서술하세요." rows={5} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.7 }} />
        </PanelField>

        {/* 인수기준 (Given / When / Then) */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)" }}>인수기준 (Given / When / Then)</label>
            <button
              onClick={() => setAcRows([...acRows, { given: "", when: "", then: "" }])}
              style={addBtnStyle}
            >
              + 추가
            </button>
          </div>

          {acRows.length === 0 && (
            <div style={{
              padding: "32px 20px", textAlign: "center",
              color: "var(--color-text-secondary)", fontSize: 13,
              border: "2px dashed var(--color-border)", borderRadius: 8,
              background: "var(--color-bg-muted)",
            }}>
              인수기준이 없습니다. 추가 버튼을 클릭해 주세요.
            </div>
          )}

          {acRows.length > 0 && (
            <div style={{
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              overflow: "hidden",
            }}>
              {/* 컬럼 헤더 — 한 번만 표시 */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "28px 1fr 1fr 1fr",
                gap: 0,
                background: "var(--color-bg-muted)",
                borderBottom: "1px solid var(--color-border)",
              }}>
                <div />
                <div style={{ padding: "8px 10px", fontSize: 11, fontWeight: 700, color: "#1565c0" }}>Given (사전조건)</div>
                <div style={{ padding: "8px 10px", fontSize: 11, fontWeight: 700, color: "#2e7d32" }}>When (행동)</div>
                <div style={{ padding: "8px 10px", fontSize: 11, fontWeight: 700, color: "#6a1b9a" }}>Then (기대결과)</div>
              </div>

              {/* 인수기준 행들 */}
              {acRows.map((row, idx) => (
                <AcRowItem
                  key={idx}
                  row={row}
                  idx={idx}
                  total={acRows.length}
                  onUpdate={(field, value) => updateAc(idx, field, value)}
                  onDelete={() => setAcRows(acRows.filter((_, i) => i !== idx))}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 인수기준 행 컴포넌트 ──────────────────────────────────────────────────────

function AcRowItem({ row, idx, total, onUpdate, onDelete }: {
  row:      AcRow;
  idx:      number;
  total:    number;
  onUpdate: (field: "given" | "when" | "then", value: string) => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{
        display:      "grid",
        gridTemplateColumns: "28px 1fr 1fr 1fr",
        gap:          0,
        borderBottom: idx < total - 1 ? "1px solid var(--color-border)" : "none",
        background:   hovered ? "var(--color-bg-muted)" : "var(--color-bg-card)",
        transition:   "background 0.12s",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 좌측 번호 + 삭제 버튼 (세로 배치) */}
      <div style={{
        display:        "flex",
        flexDirection:  "column",
        alignItems:     "center",
        paddingTop:     12,
        gap:            4,
      }}>
        <span style={{
          fontSize:   11,
          fontWeight: 700,
          color:      "var(--color-text-secondary)",
          opacity:    0.5,
        }}>
          {idx + 1}
        </span>
        {/* 삭제 — 호버 시에만 표시 */}
        <button
          onClick={onDelete}
          style={{
            background:  "none",
            border:      "none",
            cursor:      "pointer",
            color:       hovered ? "#e53935" : "transparent",
            fontSize:    13,
            lineHeight:  1,
            padding:     "2px",
            transition:  "color 0.12s",
          }}
          title="삭제"
        >×</button>
      </div>

      {/* Given / When / Then 입력 */}
      {(["given", "when", "then"] as const).map((field) => {
        const placeholders: Record<string, string> = { given: "사전 조건...", when: "사용자 행동...", then: "기대 결과..." };
        return (
          <div key={field} style={{ padding: "8px 6px" }}>
            <textarea
              value={row[field]}
              onChange={(e) => onUpdate(field, e.target.value)}
              placeholder={placeholders[field]}
              rows={4}
              style={{ ...inputStyle, resize: "vertical", fontSize: 13, lineHeight: 1.6, border: "1px solid var(--color-border)" }}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── 공통 서브 컴포넌트 ────────────────────────────────────────────────────────

function PanelLoading() {
  return <div style={{ padding: 32, color: "#888" }}>로딩 중...</div>;
}

function PanelHeader({ icon, displayType, displayId, name, onSave, isPending }: {
  icon:        string;
  displayType: string;
  displayId:   string;
  name:        string;
  onSave?:     () => void;
  isPending?:  boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
        <span style={{ fontSize: 13, flexShrink: 0 }}>{icon}</span>
        <span style={{ fontSize: 11, color: "var(--color-text-secondary)", flexShrink: 0 }}>{displayType}</span>
        {displayId && <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--color-text-secondary)", opacity: 0.6, flexShrink: 0 }}>{displayId}</span>}
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name || "(이름 없음)"}</span>
      </div>
      {onSave && (
        <button onClick={onSave} disabled={isPending} style={{ ...primaryBtnStyle, flexShrink: 0 }}>
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

// ── 사용자스토리 작성 가이드 (팝업) ──────────────────────────────────────────

function StoryGuide() {
  const [open, setOpen] = useState(false);

  const gwt = (g: string, w: string, t: string) => ({ given: g, when: w, then: t });

  // 예시 데이터 — 3개 스토리, 각각 인수기준 포함
  const examples = [
    {
      title: "멤버 초대",
      name: "PM이 프로젝트에 새 멤버를 초대할 수 있다",
      persona: "프로젝트 관리자 (PM)",
      scenario: "PM이 프로젝트 설정 > 멤버 관리에서 초대 버튼을 클릭하고, 이메일 주소를 입력하여 초대장을 발송한다.",
      ac: [
        gwt("PM이 멤버 관리 페이지에 있을 때", "유효한 이메일을 입력하고 초대 버튼을 클릭하면", "초대 메일이 발송되고 초대 현황에 '대기중'으로 표시된다"),
        gwt("이미 초대된 이메일을 입력했을 때", "초대 버튼을 클릭하면", "\"이미 초대된 이메일입니다\" 메시지가 표시된다"),
      ],
    },
    {
      title: "비밀번호 재설정",
      name: "사용자가 비밀번호를 재설정할 수 있다",
      persona: "일반 사용자",
      scenario: "사용자가 로그인 페이지에서 '비밀번호 찾기'를 누르고, 가입 이메일을 입력하면 재설정 링크가 발송된다.",
      ac: [
        gwt("로그인 페이지에서 '비밀번호 찾기'를 클릭한 상태에서", "가입된 이메일을 입력하고 '링크 발송'을 누르면", "해당 이메일로 재설정 링크가 발송되고 안내 메시지가 표시된다"),
        gwt("재설정 링크를 클릭하여 재설정 페이지에 있을 때", "새 비밀번호를 입력하고 확인하면", "비밀번호가 변경되고 로그인 페이지로 이동한다"),
      ],
    },
    {
      title: "요구사항 삭제",
      name: "관리자가 요구사항을 삭제할 수 있다",
      persona: "시스템 관리자",
      scenario: "관리자가 기획 트리에서 불필요한 요구사항을 선택하고 삭제 버튼을 눌러 하위 스토리와 함께 제거한다.",
      ac: [
        gwt("하위에 사용자스토리 3건이 연결된 요구사항이 있을 때", "삭제 버튼을 클릭하면", "\"하위 스토리 3건이 함께 삭제됩니다\" 경고가 표시된다"),
        gwt("삭제 확인 팝업이 표시된 상태에서", "\"삭제\" 버튼을 클릭하면", "요구사항과 하위 스토리가 모두 삭제되고 트리에서 사라진다"),
      ],
    },
  ];

  const labelColor = { given: "#1565c0", when: "#2e7d32", then: "#6a1b9a" };
  const thStyle: React.CSSProperties = { textAlign: "left", padding: "8px 10px", fontWeight: 700, color: "var(--color-text-primary)", borderBottom: "2px solid var(--color-border)" };
  const tdStyle: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--color-border)", verticalAlign: "top" };

  return (
    <>
      {/* 트리거 — 타이틀 옆 텍스트 링크 */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: 0, border: "none", background: "none",
          cursor: "pointer", fontSize: 12,
          color: "var(--color-primary, #1976d2)",
          textDecoration: "none",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
        onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
      >
        작성 가이드
      </button>

      {/* 팝업 오버레이 */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(860px, 90vw)", maxHeight: "85vh",
              background: "var(--color-bg-card, #fff)", borderRadius: 12,
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
              display: "flex", flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* 헤더 — sticky */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 32px 16px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 20 }}>💡</span>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--color-text-primary)" }}>
                  사용자스토리 작성 가이드
                </h2>
              </div>
              <button
                onClick={() => setOpen(false)}
                style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--color-text-secondary)", padding: "4px 8px", lineHeight: 1 }}
              >×</button>
            </div>

            {/* 스크롤 영역 */}
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 32px 28px" }}>

            {/* 필드 설명 */}
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "var(--color-text-primary)" }}>각 필드 설명</h3>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, width: 100 }}>필드</th>
                    <th style={thStyle}>설명</th>
                    <th style={thStyle}>작성 팁</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>스토리명</td>
                    <td style={tdStyle}>사용자 관점에서 기능을 한 문장으로 요약</td>
                    <td style={{ ...tdStyle, fontSize: 12, color: "var(--color-text-secondary)" }}>&ldquo;[누가] [무엇을] 할 수 있다&rdquo; 형태로 작성</td>
                  </tr>
                  <tr>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>페르소나</td>
                    <td style={tdStyle}>이 기능의 주요 사용자/역할</td>
                    <td style={{ ...tdStyle, fontSize: 12, color: "var(--color-text-secondary)" }}>역할명 + 부연설명 (예: &ldquo;PM (프로젝트 관리자)&rdquo;)</td>
                  </tr>
                  <tr>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>시나리오</td>
                    <td style={tdStyle}>사용자의 행동 흐름을 자연어로 서술</td>
                    <td style={{ ...tdStyle, fontSize: 12, color: "var(--color-text-secondary)" }}>시간 순서대로 2~3문장이 적당</td>
                  </tr>
                  <tr>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>인수기준</td>
                    <td style={tdStyle}>기능이 &ldquo;완료&rdquo;되었다고 판단할 수 있는 검증 조건</td>
                    <td style={{ ...tdStyle, fontSize: 12, color: "var(--color-text-secondary)" }}>정상 케이스 + 예외 케이스를 각각 작성하면 좋음</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Given/When/Then 설명 */}
            <div style={{
              marginBottom: 24, padding: "14px 16px", borderRadius: 8,
              background: "var(--color-bg-muted, #f5f6f8)",
              border: "1px solid var(--color-border)",
            }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "var(--color-text-primary)" }}>
                인수기준 — Given / When / Then 이란?
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, fontSize: 13 }}>
                <div>
                  <div style={{ fontWeight: 700, color: labelColor.given, marginBottom: 4 }}>Given (사전 조건)</div>
                  <div style={{ color: "var(--color-text-secondary)", lineHeight: 1.6 }}>시나리오 시작 전의 상태<br />&ldquo;~한 상황에서&rdquo;</div>
                </div>
                <div>
                  <div style={{ fontWeight: 700, color: labelColor.when, marginBottom: 4 }}>When (행동)</div>
                  <div style={{ color: "var(--color-text-secondary)", lineHeight: 1.6 }}>사용자가 수행하는 동작<br />&ldquo;~을 하면&rdquo;</div>
                </div>
                <div>
                  <div style={{ fontWeight: 700, color: labelColor.then, marginBottom: 4 }}>Then (기대 결과)</div>
                  <div style={{ color: "var(--color-text-secondary)", lineHeight: 1.6 }}>시스템의 기대 반응/결과<br />&ldquo;~이 되어야 한다&rdquo;</div>
                </div>
              </div>
            </div>

            {/* 작성 예시 — 3개 */}
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14, color: "var(--color-text-primary)" }}>
                작성 예시
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {examples.map((ex, i) => (
                  <div key={i} style={{
                    border: "1px solid var(--color-border)", borderRadius: 8,
                    overflow: "hidden",
                  }}>
                    {/* 예시 헤더 */}
                    <div style={{
                      padding: "10px 14px", fontSize: 13, fontWeight: 700,
                      background: "var(--color-bg-muted, #f5f6f8)",
                      borderBottom: "1px solid var(--color-border)",
                      color: "var(--color-text-primary)",
                    }}>
                      예시 {i + 1}. {ex.title}
                    </div>
                    <div style={{ padding: "14px 16px", fontSize: 13, lineHeight: 1.7 }}>
                      {/* 필드들 */}
                      <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: "6px 12px", marginBottom: 14 }}>
                        <span style={{ fontWeight: 600, color: "var(--color-text-secondary)" }}>스토리명</span>
                        <span>{ex.name}</span>
                        <span style={{ fontWeight: 600, color: "var(--color-text-secondary)" }}>페르소나</span>
                        <span>{ex.persona}</span>
                        <span style={{ fontWeight: 600, color: "var(--color-text-secondary)" }}>시나리오</span>
                        <span>{ex.scenario}</span>
                      </div>
                      {/* 인수기준 */}
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: "var(--color-text-secondary)" }}>인수기준</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {ex.ac.map((ac, j) => (
                          <div key={j} style={{
                            display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10,
                            padding: "10px 12px", borderRadius: 6,
                            background: "var(--color-bg-muted, #f5f6f8)",
                            fontSize: 12, lineHeight: 1.6,
                          }}>
                            <div>
                              <div style={{ fontWeight: 700, color: labelColor.given, marginBottom: 3 }}>Given</div>
                              <div style={{ color: "var(--color-text-secondary)" }}>{ac.given}</div>
                            </div>
                            <div>
                              <div style={{ fontWeight: 700, color: labelColor.when, marginBottom: 3 }}>When</div>
                              <div style={{ color: "var(--color-text-secondary)" }}>{ac.when}</div>
                            </div>
                            <div>
                              <div style={{ fontWeight: 700, color: labelColor.then, marginBottom: 3 }}>Then</div>
                              <div style={{ color: "var(--color-text-secondary)" }}>{ac.then}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 하단 닫기 */}
            <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => setOpen(false)} style={{ ...primaryBtnStyle, padding: "8px 24px", fontSize: 14 }}>
                닫기
              </button>
            </div>

            </div>{/* 스크롤 영역 끝 */}
          </div>
        </div>
      )}
    </>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  padding:   "16px 24px",
  maxWidth:  828,
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
