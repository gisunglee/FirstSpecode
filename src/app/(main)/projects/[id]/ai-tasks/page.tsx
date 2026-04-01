"use client";

/**
 * AiTasksPage — AI 태스크 목록 (PID-00054)
 *
 * 역할:
 *   - AI 태스크 목록 조회 (FID-00182) — 상태/유형/대상 필터
 *   - 대상 상세 이동 (FID-00183) — 영역/기능 링크 클릭
 *   - AI 태스크 재요청 (FID-00184) — FAILED/REJECTED/TIMEOUT 상태
 *   - AI 태스크 강제 취소 (FID-00201) — IN_PROGRESS 5분 초과 좀비 태스크
 *   - AI 태스크 결과 확인 팝업 (PID-00056) — DONE 상태 결과 확인·반영·반려
 *
 * 주요 기술:
 *   - TanStack Query: 목록 조회 및 뮤테이션 후 캐시 무효화
 *   - 30초 자동 폴링: IN_PROGRESS 상태 태스크가 있을 때만 활성화
 */

import { Suspense, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import MarkdownEditor from "@/components/ui/MarkdownEditor";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type TaskStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "APPLIED" | "REJECTED" | "FAILED" | "TIMEOUT";
type TaskType   = "INSPECT" | "DESIGN" | "IMPLEMENT" | "MOCKUP" | "IMPACT" | "CUSTOM";
type RefType    = "AREA" | "FUNCTION";

type TaskRow = {
  taskId:       string;
  taskType:     TaskType;
  refType:      RefType;
  refId:        string;
  refName:      string;
  refDisplayId: string;
  status:       TaskStatus;
  comment:      string;
  reqCn:        string;
  resultCn:     string;
  requestedAt:  string;
  completedAt:  string | null;
  isZombie:     boolean;
  elapsedMs:    number;
  reqMberName:  string;
  retryCnt:     number;
  execAvlblDt:  string | null;
};

type TaskDetail = TaskRow & {
  rejectReason: string;
  appliedAt:    string | null;
  reqMberId?:   string;
  reqMberName?: string;
  execAvlblDt?: string | null;
  retryCnt?:    number;
  parentTaskId?: string | null;
};

// ── 상수 ──────────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<TaskStatus, string> = {
  PENDING:     "대기",
  IN_PROGRESS: "처리중",
  DONE:        "완료",
  APPLIED:     "반영됨",
  REJECTED:    "반려",
  FAILED:      "실패",
  TIMEOUT:     "시간초과",
};

const TASK_TYPE_LABELS: Record<TaskType, string> = {
  INSPECT:   "명세 검토",
  DESIGN:    "설계",
  IMPLEMENT: "구현 가이드",
  MOCKUP:    "목업",
  IMPACT:    "영향도 분석",
  CUSTOM:    "자유 요청",
};

// ── 배지 스타일 함수 ─────────────────────────────────────────────────────────

function statusBadgeStyle(status: TaskStatus): React.CSSProperties {
  const colors: Record<TaskStatus, { bg: string; color: string }> = {
    PENDING:     { bg: "#f5f5f5", color: "#666666" },
    IN_PROGRESS: { bg: "#e3f2fd", color: "#1565c0" },
    DONE:        { bg: "#e8f5e9", color: "#2e7d32" },
    APPLIED:     { bg: "#e8eaf6", color: "#283593" },
    REJECTED:    { bg: "#fff3e0", color: "#e65100" },
    FAILED:      { bg: "#ffebee", color: "#c62828" },
    TIMEOUT:     { bg: "#fff3e0", color: "#e65100" },
  };
  const c = colors[status] ?? { bg: "#f5f5f5", color: "#555" };
  return {
    display:      "inline-block",
    padding:      "2px 8px",
    borderRadius: 4,
    fontSize:     11,
    fontWeight:   700,
    background:   c.bg,
    color:        c.color,
    border:       `1px solid ${c.color}20`,
  };
}

function taskTypeBadgeStyle(type: TaskType): React.CSSProperties {
  const colors: Record<TaskType, { bg: string; color: string }> = {
    INSPECT:   { bg: "#f5f5f5", color: "#616161" },
    DESIGN:    { bg: "#e8eaf6", color: "#3f51b5" },
    IMPLEMENT: { bg: "#e1f5fe", color: "#0288d1" },
    MOCKUP:    { bg: "#f1f8e9", color: "#558b2f" },
    IMPACT:    { bg: "#fff3e0", color: "#ef6c00" },
    CUSTOM:    { bg: "#f5f5f5", color: "#757575" },
  };
  const c = colors[type] ?? { bg: "#f5f5f5", color: "#555" };
  return {
    display:      "inline-block",
    padding:      "2px 8px",
    borderRadius: 4,
    fontSize:     11,
    fontWeight:   700,
    background:   c.bg,
    color:        c.color,
  };
}

function refTypeBadgeStyle(type: RefType): React.CSSProperties {
  const isArea = type === "AREA";
  return {
    display:      "inline-block",
    padding:      "2px 6px",
    borderRadius: 4,
    fontSize:     11,
    fontWeight:   700,
    backgroundColor: isArea ? "#f5f5f5" : "#f3e5f5",
    color:           isArea ? "#666666" : "#7b1fa2",
    border:          "1px solid var(--color-border)",
  };
}

// ── 유틸 ──────────────────────────────────────────────────────────────────────

function formatDatetime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60)  return `${s}초 경과`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}분 경과`;
  return `${Math.floor(m / 60)}시간 경과`;
}

// 소요 시간 포맷 (시작 ~ 완료) — 절댓값 사용 (DB 시간 오차 방어)
function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return "-";
  const ms = Math.abs(new Date(endIso).getTime() - new Date(startIso).getTime());
  const s  = Math.floor(ms / 1000);
  if (s === 0) return "1초 미만";
  if (s < 60)  return `${s}초`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}분`;
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `${h}시간` : `${h}시간 ${m % 60}분`;
}

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function AiTasksPage() {
  return (
    <Suspense fallback={null}>
      <AiTasksPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function AiTasksPageInner() {
  const params      = useParams<{ id: string }>();
  const router      = useRouter();
  const queryClient = useQueryClient();
  const projectId   = params.id;

  // ── 필터 상태 ──────────────────────────────────────────────────────────────
  const [filterStatus,   setFilterStatus]   = useState<string>("");
  const [filterTaskType, setFilterTaskType] = useState<string>("");
  const [filterRefType,  setFilterRefType]  = useState<string>("");

  // ── 선택된 row 상태 (상세 패널) ───────────────────────────────────────────
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // ── 강제 취소 확인 상태 ────────────────────────────────────────────────────
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);

  // ── 데이터 조회 ────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ["ai-tasks", projectId, filterStatus, filterTaskType, filterRefType],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (filterStatus)   sp.set("status",   filterStatus);
      if (filterTaskType) sp.set("taskType", filterTaskType);
      if (filterRefType)  sp.set("refType",  filterRefType);
      const qs = sp.toString() ? `?${sp.toString()}` : "";
      return authFetch<{ data: { items: TaskRow[]; totalCount: number } }>(
        `/api/projects/${projectId}/ai-tasks${qs}`
      ).then((r) => r.data);
    },
    refetchInterval: (query) => {
      const items = (query.state.data as { items: TaskRow[] } | undefined)?.items ?? [];
      return items.some((t) => t.status === "IN_PROGRESS") ? 10_000 : false;
    },
  });

  const items      = data?.items      ?? [];
  const totalCount = data?.totalCount ?? 0;

  // ── 강제 취소 뮤테이션 ─────────────────────────────────────────────────────
  const cancelMutation = useMutation<{ data: { taskId: string } }, Error, string>({
    mutationFn: (taskId) =>
      authFetch(`/api/projects/${projectId}/ai-tasks/${taskId}/cancel`, { method: "POST" }),
    onSuccess: () => {
      toast.success("태스크가 취소되었습니다.");
      setCancelConfirmId(null);
      queryClient.invalidateQueries({ queryKey: ["ai-tasks", projectId] });
    },
    onError: (err) => toast.error(err.message),
  });

  // ── 재요청 뮤테이션 (FAILED/REJECTED/TIMEOUT 전용) ────────────────────────
  const retryMutation = useMutation<{ data: { taskId: string } }, Error, string>({
    mutationFn: (taskId) =>
      authFetch(`/api/projects/${projectId}/ai-tasks/${taskId}/retry`, { method: "POST" }),
    onSuccess: () => {
      toast.success("재요청이 접수되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["ai-tasks", projectId] });
    },
    onError: (err) => toast.error(err.message),
  });

  // ── 대상 상세 이동 ─────────────────────────────────────────────────────────
  function navigateToRef(row: TaskRow) {
    if (row.refType === "AREA") {
      router.push(`/projects/${projectId}/areas/${row.refId}`);
    } else {
      router.push(`/projects/${projectId}/functions/${row.refId}`);
    }
  }

  // ── 10컬럼 그리드 템플릿 (1115px) ──────────────────────────────────────────
  const GRID_CONFIG = "70px 100px minmax(150px, 1fr) 80px 144px 144px 80px 50px 85px 140px";

  return (
    <div style={{ padding: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)", marginBottom: 16 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
          AI 태스크 목록
        </div>
      </div>

      <div style={{ padding: "0 24px 24px" }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ ...filterSelectStyle, width: 140 }}>
            <option value="">상태 전체</option>
            <option value="PENDING">대기</option>
            <option value="IN_PROGRESS">처리중</option>
            <option value="DONE">완료</option>
            <option value="APPLIED">반영됨</option>
            <option value="REJECTED">반려</option>
            <option value="FAILED">실패</option>
            <option value="TIMEOUT">시간초과</option>
          </select>

          <select value={filterTaskType} onChange={(e) => setFilterTaskType(e.target.value)} style={{ ...filterSelectStyle, width: 140 }}>
            <option value="">유형 전체</option>
            <option value="INSPECT">명세 검토</option>
            <option value="DESIGN">설계</option>
            <option value="IMPLEMENT">구현 가이드</option>
            <option value="MOCKUP">목업</option>
            <option value="IMPACT">영향도 분석</option>
            <option value="CUSTOM">자유 요청</option>
          </select>

          <select value={filterRefType} onChange={(e) => setFilterRefType(e.target.value)} style={{ ...filterSelectStyle, width: 140 }}>
            <option value="">대상 전체</option>
            <option value="AREA">영역</option>
            <option value="FUNCTION">기능</option>
          </select>
          <div style={{ flex: 1 }} />
        </div>

        <div style={{ marginBottom: 16, fontSize: 14, color: "var(--color-text-secondary)" }}>
          총 {totalCount}건
        </div>

        <div>
          {isLoading ? (
            <div style={{ padding: "40px 32px", color: "#888" }}>불러오는 중...</div>
          ) : items.length === 0 ? (
            <div style={{ padding: "60px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
              AI 태스크가 없습니다.
            </div>
          ) : (
            <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
              <div style={{ ...gridHeaderStyle, gridTemplateColumns: GRID_CONFIG }}>
                <div style={{ textAlign: "center" }}>요청 구분</div>
                <div style={{ textAlign: "center" }}>작업유형</div>
                <div>대상</div>
                <div style={{ textAlign: "center" }}>요청자</div>
                <div style={{ textAlign: "center" }}>요청일시</div>
                <div style={{ textAlign: "center" }}>완료일시</div>
                <div style={{ textAlign: "center" }}>소요</div>
                <div style={{ textAlign: "center" }}>재시도</div>
                <div style={{ textAlign: "center" }}>상태 / 액션</div>
                <div style={{ textAlign: "center" }}>실행 가능일</div>
              </div>

              {items.map((row, idx) => (
                <div
                  key={row.taskId}
                  onClick={() => setSelectedTaskId(row.taskId === selectedTaskId ? null : row.taskId)}
                  style={{
                    ...gridRowStyle,
                    gridTemplateColumns: GRID_CONFIG,
                    borderTop:   idx === 0 ? "none" : "1px solid var(--color-border)",
                    cursor:      "pointer",
                    background:  row.taskId === selectedTaskId ? "var(--color-brand-subtle, #e8f0fe)" : "var(--color-bg-card)",
                    borderLeft:  row.taskId === selectedTaskId ? "3px solid var(--color-brand, #1976d2)" : "3px solid transparent",
                  }}
                >
                  <div style={{ textAlign: "center" }}>
                    <span style={refTypeBadgeStyle(row.refType)}>
                      {row.refType === "AREA" ? "영역" : "기능"}
                    </span>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <span style={taskTypeBadgeStyle(row.taskType)}>
                      {TASK_TYPE_LABELS[row.taskType]}
                    </span>
                  </div>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <button style={{ ...linkBtnStyle, fontWeight: 500, display: "inline-flex", alignItems: "center" }} onClick={(e) => { e.stopPropagation(); navigateToRef(row); }} type="button">
                      {row.refDisplayId && <span style={{ color: "var(--color-primary)", fontSize: 13, marginRight: 6, fontWeight: 600 }}>{row.refDisplayId}</span>}
                      {row.refName}
                    </button>
                  </div>
                  <div style={{ textAlign: "center", fontSize: 13, color: "var(--color-text-primary)" }}>{row.reqMberName}</div>
                  <div style={{ textAlign: "center", fontSize: 12, color: "var(--color-text-secondary)" }}>{formatDatetime(row.requestedAt)}</div>
                  <div style={{ textAlign: "center", fontSize: 12, color: "var(--color-text-secondary)" }}>{row.completedAt ? formatDatetime(row.completedAt) : "—"}</div>
                  <div style={{ textAlign: "center", fontSize: 12, fontWeight: 600, color: "var(--color-text-primary)" }}>
                    {row.completedAt ? formatDuration(row.requestedAt, row.completedAt) : (row.status === "IN_PROGRESS" ? formatElapsed(row.elapsedMs) : "—")}
                  </div>
                  <div style={{ textAlign: "center", fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>{row.retryCnt}회</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    <span style={statusBadgeStyle(row.status)}>{STATUS_LABELS[row.status]}</span>
                    {["FAILED", "REJECTED", "TIMEOUT"].includes(row.status) && (
                      <button title="재요청" style={{ ...actionBtnStyle, padding: "2px 5px", fontSize: 14 }} onClick={(e) => { e.stopPropagation(); if (window.confirm("재요청 하시겠습니까?")) retryMutation.mutate(row.taskId); }} disabled={retryMutation.isPending} type="button">↺</button>
                    )}
                  </div>
                  <div style={{ textAlign: "center", fontSize: 12, color: "var(--color-text-secondary)" }}>{row.execAvlblDt ? formatDatetime(row.execAvlblDt) : "—"}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedTaskId && (
          <TaskDetailPanel projectId={projectId} taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
        )}

        {cancelConfirmId && (
          <CancelConfirmDialog onConfirm={() => cancelMutation.mutate(cancelConfirmId)} onClose={() => setCancelConfirmId(null)} isPending={cancelMutation.isPending} />
        )}
      </div>
    </div>
  );
}

// ── 상세 모달 ─────────────────────────────────────────────────────────────────

function TaskDetailPanel({
  projectId,
  taskId,
  onClose,
  onApplied,
  onRejected,
}: {
  projectId: string;
  taskId:    string;
  onClose:   () => void;
  onApplied?: () => void;
  onRejected?: () => void;
}) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["ai-task-detail", projectId, taskId],
    queryFn:  () =>
      authFetch<{ data: TaskDetail }>(
        `/api/projects/${projectId}/ai-tasks/${taskId}`
      ).then((r) => r.data),
  });

  // 상태 수정 뮤테이션
  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      authFetch(`/api/projects/${projectId}/ai-tasks/${taskId}`, {
        method: "PATCH",
        body:   JSON.stringify({ status }),
      }),
    onSuccess: () => {
      toast.success("상태가 수정되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["ai-task-detail", projectId, taskId] });
      queryClient.invalidateQueries({ queryKey: ["ai-tasks", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // 삭제 뮤테이션
  const deleteMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/ai-tasks/${taskId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["ai-tasks", projectId] });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 좌/우 패널 탭 상태 ─────────────────────────────────────────────────────
  const [reqTab,    setReqTab]    = useState<"edit" | "preview">("preview");
  const [resultTab, setResultTab] = useState<"edit" | "preview">("preview");
  const [rejectTab, setResultRejectTab] = useState<"edit" | "preview">("preview");

  // ── 반영 뮤테이션 ──────────────────────────────────────────────────────────
  const applyMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/ai-tasks/${taskId}/apply`, { method: "POST" }),
    onSuccess: () => {
      toast.success("결과가 반영되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["ai-tasks", projectId] });
      if (onApplied) onApplied();
      else onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 반려 뮤테이션 ──────────────────────────────────────────────────────────
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const rejectMutation = useMutation({
    mutationFn: (reason: string) =>
      authFetch(`/api/projects/${projectId}/ai-tasks/${taskId}/reject`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ rejectReason: reason }),
      }),
    onSuccess: () => {
      toast.success("태스크가 반려되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["ai-tasks", projectId] });
      if (onRejected) onRejected();
      else onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleReject() {
    if (!rejectReason.trim()) {
      toast.error("반려 사유를 입력해 주세요.");
      return;
    }
    rejectMutation.mutate(rejectReason.trim());
  }

  // 로컬 탭 버튼 컴포넌트 (디자인 통일을 위해 로컬 정의)
  function LocalTabButtons({ tab, onTabChange }: { tab: "edit" | "preview", onTabChange: (t: "edit" | "preview") => void }) {
    return (
      <div style={{ display: "flex", gap: 2, background: "var(--color-bg-muted)", padding: "3px", borderRadius: 7 }}>
        <button
          type="button"
          onClick={() => onTabChange("preview")}
          style={{
            padding: "4px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
            borderRadius: 5, border: "none",
            transition: "all 0.15s",
            background: tab === "preview" ? "var(--color-primary, #1976d2)" : "transparent",
            color: tab === "preview" ? "#fff" : "var(--color-text-secondary)",
          }}
        >
          미리보기
        </button>
        <button
          type="button"
          onClick={() => onTabChange("edit")}
          style={{
            padding: "4px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
            borderRadius: 5, border: "none",
            transition: "all 0.15s",
            background: tab === "edit" ? "var(--color-primary, #1976d2)" : "transparent",
            color: tab === "edit" ? "#fff" : "var(--color-text-secondary)",
          }}
        >
          원문
        </button>
      </div>
    );
  }

  return (
    // 오버레이 — 클릭 시 닫기
    <div
      onClick={onClose}
      style={{
        position:       "fixed",
        inset:          0,
        background:     "rgba(0,0,0,0.45)",
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        zIndex:         1000,
      }}
    >
      {/* 모달 본체 — 클릭 버블 차단 */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width:        "min(1340px, 95vw)",
          height:       "85vh",
          display:      "flex",
          flexDirection:"column",
          border:       "1px solid var(--color-border)",
          borderRadius: 10,
          background:   "var(--color-bg-card)",
          boxShadow:    "0 8px 32px rgba(0,0,0,0.18)",
          overflow:     "hidden",
        }}
      >
        {/* 헤더 */}
        <div
          style={{
            display:        "flex",
            alignItems:     "center",
            justifyContent: "space-between",
            padding:        "14px 20px",
            borderBottom:   "1px solid var(--color-border)",
            background:     "var(--color-bg-muted)",
            flexShrink:     0,
          }}
        >
          <div>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>
              AI 태스크 상세
            </span>
            {data && (
                <span style={{ 
                  fontSize: 10, 
                  fontFamily: '"JetBrains Mono", "Roboto Mono", monospace', 
                  color: "var(--color-text-secondary)", 
                  marginLeft: 12, 
                  opacity: 0.5,
                  letterSpacing: "0.02em"
                }}>
                  {data.taskId}
                </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              padding:      "5px 12px",
              background:   "var(--color-bg-muted)",
              border:       "1px solid var(--color-border)",
              borderRadius: 4,
              fontSize:     12,
              fontWeight:   600,
              cursor:       "pointer",
              color:        "var(--color-text-primary)",
              transition:   "all 0.2s ease",
            }}
            onMouseOver={(e) => e.currentTarget.style.background = "#ececec"}
            onMouseOut={(e) => e.currentTarget.style.background = "var(--color-bg-muted)"}
          >
            닫기
          </button>
        </div>

        {isLoading ? (
          <div style={{ padding: "48px", textAlign: "center", color: "#aaa", fontSize: 13 }}>
            불러오는 중...
          </div>
        ) : !data ? (
          <div style={{ padding: "48px", textAlign: "center", color: "#aaa", fontSize: 13 }}>
            데이터를 불러올 수 없습니다.
          </div>
        ) : (
          <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
            {/* 메타 정보 (한 줄 합치기) */}
            <div
              style={{
                padding:      "10px 20px",
                borderBottom: "1px solid var(--color-border)",
                display:      "flex",
                alignItems:   "center",
                gap:          "24px",
                flexWrap:     "wrap",
                background:   "var(--color-bg-card)",
                flexShrink:   0,
              }}
            >
              {/* 왼쪽: 구분/유형/상태 + 대상 */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={taskTypeBadgeStyle(data.taskType)}>
                  {TASK_TYPE_LABELS[data.taskType]}
                </span>
                <span style={statusBadgeStyle(data.status)}>
                  {STATUS_LABELS[data.status]}
                </span>
                
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
                  {data.refDisplayId && (
                    <span style={{ fontSize: 15, fontWeight: 600, color: "var(--color-primary)" }}>
                      {data.refDisplayId}
                    </span>
                  )}
                  <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)" }}>
                    {data.refName}
                  </span>
                </div>
              </div>

              {/* 오른쪽: 요청자 / 재시도 / 일시 */}
              <div style={{ display: "flex", alignItems: "center", gap: "20px", flexWrap: "wrap", fontSize: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: "var(--color-text-secondary)", fontSize: 11 }}>요청자</span>
                  <span style={{ color: "var(--color-text-primary)", fontWeight: 700 }}>{data.reqMberName || "—"}</span>
                </div>
                {data.retryCnt !== undefined && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: "var(--color-text-secondary)", fontSize: 11 }}>재시도</span>
                    <span style={{ color: "var(--color-text-primary)", fontWeight: 700 }}>{data.retryCnt}회</span>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: "var(--color-text-secondary)", fontSize: 11 }}>요청일시</span>
                  <span style={{ color: "var(--color-text-primary)" }}>{formatDatetime(data.requestedAt)}</span>
                </div>
                {data.completedAt && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: "var(--color-text-secondary)", fontSize: 11 }}>완료일시</span>
                    <span style={{ color: "var(--color-text-primary)" }}>{formatDatetime(data.completedAt)}</span>
                  </div>
                )}
              </div>

              {/* 액션 버튼 그룹 (상단 우측으로 이동) */}
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
                {/* 결과 반영/반려 버튼 (DONE 상태일 때 노출) */}
                {data.status === "DONE" && (
                  <div style={{ display: "flex", gap: 8 }}>
                    {!rejectMode ? (
                      <>
                        <button onClick={() => setRejectMode(true)} style={{ ...secondaryBtnStyle, padding: "5px 12px", fontSize: 12 }}>
                          반려
                        </button>
                        <button
                          onClick={() => applyMutation.mutate()}
                          disabled={applyMutation.isPending}
                          style={{ ...primaryBtnStyle, padding: "5px 14px", fontSize: 12 }}
                        >
                          {applyMutation.isPending ? "반영 중..." : "결과 반영"}
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => { setRejectMode(false); setRejectReason(""); }} style={{ ...secondaryBtnStyle, padding: "5px 12px", fontSize: 12 }}>
                          취소
                        </button>
                        <button
                          onClick={handleReject}
                          disabled={rejectMutation.isPending}
                          style={{ ...primaryBtnStyle, padding: "5px 14px", fontSize: 12, background: "var(--color-warning, #f59e0b)" }}
                        >
                          {rejectMutation.isPending ? "반려 처리 중..." : "반려 확인"}
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* 상태 콤보박스 (반려 모드 아닐 때 노출) */}
                {!rejectMode && data.status !== "DONE" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>상태 변경</span>
                    <select
                      value={data.status}
                      disabled={statusMutation.isPending}
                      onChange={(e) => statusMutation.mutate(e.target.value)}
                      style={{
                        padding:      "4px 28px 4px 10px",
                        borderRadius: 6,
                        border:       "1px solid var(--color-border)",
                        background:   "var(--color-bg-card)",
                        color:        "var(--color-text-primary)",
                        fontSize:     12,
                        cursor:       "pointer",
                        appearance:   "none",
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                        backgroundRepeat:   "no-repeat",
                        backgroundPosition: "right 8px center",
                      }}
                    >
                      <option value="PENDING">대기</option>
                      <option value="IN_PROGRESS">처리중</option>
                      <option value="DONE">완료</option>
                      <option value="APPLIED">반영됨</option>
                      <option value="REJECTED">반려</option>
                      <option value="FAILED">실패</option>
                      <option value="TIMEOUT">시간초과</option>
                    </select>
                  </div>
                )}

                {/* 삭제 버튼 (반려 모드 아닐 때 노출, 가장 오른쪽에 배치) */}
                {!rejectMode && (
                  <button
                    type="button"
                    disabled={deleteMutation.isPending}
                    onClick={() => {
                      if (window.confirm("이 AI 태스크를 삭제하시겠습니까?")) {
                        deleteMutation.mutate();
                      }
                    }}
                    style={{ ...dangerBtnStyle, fontSize: 12, padding: "5px 14px" }}
                  >
                    삭제
                  </button>
                )}
              </div>
            </div>

            {/* 좌: 요청 Spec / 우: 응답 피드백 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", flex: 1, minHeight: 0, borderTop: "1px solid var(--color-border)" }}>
              {/* 요청 Spec */}
              <div
                style={{
                  padding:      "12px 20px",
                  borderRight:  "1px solid var(--color-border)",
                  display:      "flex",
                  flexDirection:"column",
                  overflow:     "hidden",
                  minHeight:    0,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)" }}>
                    요청 SPEC
                  </span>
                  <LocalTabButtons tab={reqTab} onTabChange={setReqTab} />
                </div>
                <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
                  <MarkdownEditor
                    value={[data.comment, data.reqCn ? `\n\n---\n\n${data.reqCn}` : ""].filter(Boolean).join("")}
                    onChange={() => {}}
                    readOnly={true}
                    tab={reqTab}
                    onTabChange={setReqTab}
                    fullHeight={true}
                  />
                </div>
              </div>

              {/* 응답 피드백 */}
              <div
                style={{
                  padding:      "12px 20px",
                  display:      "flex",
                  flexDirection:"column",
                  overflow:     "hidden",
                  minHeight:    0,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)" }}>
                    응답 피드백
                  </span>
                  <LocalTabButtons tab={resultTab} onTabChange={setResultTab} />
                </div>
                <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
                  <MarkdownEditor
                    value={data.resultCn || ""}
                    onChange={() => {}}
                    readOnly={true}
                    tab={resultTab}
                    onTabChange={setResultTab}
                    fullHeight={true}
                    placeholder="결과 데이터가 없습니다."
                  />
                </div>
              </div>
            </div>

            {/* 반려 사유 (입력 모드 or 기존 데이터) */}
            {rejectMode ? (
              <div style={{ padding: "12px 20px", borderTop: "1px solid var(--color-border)", background: "#fff9f9", flexShrink: 0 }}>
                <div style={panelLabelStyle}>반려 사유 (필수)</div>
                <MarkdownEditor
                  value={rejectReason}
                  onChange={setRejectReason}
                  placeholder="반려 사유를 입력해 주세요."
                  rows={4}
                />
              </div>
            ) : data.rejectReason && (
              <div
                style={{
                  padding:     "12px 20px",
                  borderTop:   "1px solid var(--color-border)",
                  background:  "var(--color-bg-muted)",
                  flexShrink:  0,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={panelLabelStyle}>반려 사유</span>
                  <LocalTabButtons tab={rejectTab} onTabChange={setResultRejectTab} />
                </div>
                <div style={{ flex: 1, overflow: "hidden", marginTop: 4 }}>
                   <MarkdownEditor
                     value={data.rejectReason}
                     onChange={() => {}}
                     readOnly={true}
                     tab={rejectTab}
                     onTabChange={setResultRejectTab}
                     rows={3}
                   />
                </div>
              </div>
            )}

            <div style={{ height: 10 }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── 강제 취소 확인 다이얼로그 ─────────────────────────────────────────────────

function CancelConfirmDialog({
  onConfirm,
  onClose,
  isPending,
}: {
  onConfirm:  () => void;
  onClose:    () => void;
  isPending:  boolean;
}) {
  return (
    <div className="sp-modal-backdrop">
      <div className="sp-modal">
        <div className="sp-modal__header">
          <h2 className="sp-modal__title">AI 처리 강제 취소</h2>
        </div>
        <div className="sp-modal__body">
          <p>AI 처리가 지연되고 있습니다. 강제 취소하시겠습니까?</p>
          <p className="sp-text--muted" style={{ marginTop: 8, fontSize: 13 }}>
            취소 후 재요청이 가능합니다.
          </p>
        </div>
        <div className="sp-modal__footer">
          <button className="sp-btn sp-btn--secondary" onClick={onClose} type="button">
            취소
          </button>
          <button
            className="sp-btn sp-btn--danger"
            onClick={onConfirm}
            disabled={isPending}
            type="button"
          >
            {isPending ? "처리중..." : "강제 취소"}
          </button>
        </div>
      </div>
    </div>
  );
}



// ── 스타일 ────────────────────────────────────────────────────────────────────

const GRID_TEMPLATE = "60px 120px 280px 120px 120px 90px 1fr";

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
  textAlign:           "center",
  // 데이터 행의 borderLeft(3px)와 맞추기 위해 동일하게 추가
  borderLeft:          "3px solid transparent",
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

const filterSelectStyle: React.CSSProperties = {
  padding:      "7px 12px",
  borderRadius: 6,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     13,
  outline:      "none",
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
  padding:      "6px 14px",
  borderRadius: 4,
  border:       "none",
  background:   "var(--color-primary, #1976d2)",
  color:        "#fff",
  fontSize:     13,
  fontWeight:   600,
  cursor:       "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding:      "6px 14px",
  borderRadius: 4,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     13,
  cursor:       "pointer",
};

const panelLabelStyle: React.CSSProperties = {
  fontSize:      11,
  fontWeight:    700,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color:         "var(--color-text-secondary)",
  marginBottom:  6,
};

const panelBodyStyle: React.CSSProperties = {
  fontSize:   12,
  lineHeight: 1.6,
  color:      "var(--color-text-primary)",
  whiteSpace: "pre-wrap",
  wordBreak:  "break-word",
};


const actionBtnStyle: React.CSSProperties = {
  background: "none",
  border:     "1px solid var(--color-border)",
  borderRadius: 4,
  cursor:     "pointer",
  color:      "var(--color-text-secondary)",
  lineHeight: 1,
  transition: "all 0.2s ease",
};

const dangerBtnStyle: React.CSSProperties = {
  padding:      "6px 14px",
  borderRadius: 4,
  border:       "1px solid #e53935",
  background:   "transparent",
  color:        "#e53935",
  fontSize:     13,
  cursor:       "pointer",
};

const cellInputStyle: React.CSSProperties = {
  padding:      "6px 10px",
  borderRadius: 4,
  border:       "1px solid var(--color-border)",
  fontSize:     12,
  outline:      "none",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
};

