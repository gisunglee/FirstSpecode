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
  resultCn:     string;
  requestedAt:  string;
  completedAt:  string | null;
  isZombie:     boolean;
  elapsedMs:    number;
};

type TaskDetail = TaskRow & {
  rejectReason: string;
  appliedAt:    string | null;
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

const STATUS_COLORS: Record<TaskStatus, string> = {
  PENDING:     "sp-badge sp-badge--neutral",
  IN_PROGRESS: "sp-badge sp-badge--info",
  DONE:        "sp-badge sp-badge--success",
  APPLIED:     "sp-badge sp-badge--primary",
  REJECTED:    "sp-badge sp-badge--warning",
  FAILED:      "sp-badge sp-badge--danger",
  TIMEOUT:     "sp-badge sp-badge--warning",
};

const TASK_TYPE_LABELS: Record<TaskType, string> = {
  INSPECT:   "명세 검토",
  DESIGN:    "설계",
  IMPLEMENT: "구현 가이드",
  MOCKUP:    "목업",
  IMPACT:    "영향도 분석",
  CUSTOM:    "자유 요청",
};

const TASK_TYPE_COLORS: Record<TaskType, string> = {
  INSPECT:   "sp-badge sp-badge--neutral",
  DESIGN:    "sp-badge sp-badge--primary",
  IMPLEMENT: "sp-badge sp-badge--info",
  MOCKUP:    "sp-badge sp-badge--success",
  IMPACT:    "sp-badge sp-badge--warning",
  CUSTOM:    "sp-badge sp-badge--neutral",
};

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

  // ── 결과 확인 팝업 상태 ────────────────────────────────────────────────────
  const [resultPopupTaskId, setResultPopupTaskId] = useState<string | null>(null);

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
    // IN_PROGRESS 태스크가 있으면 30초마다 자동 폴링
    refetchInterval: (query) => {
      const items = (query.state.data as { items: TaskRow[] } | undefined)?.items ?? [];
      return items.some((t) => t.status === "IN_PROGRESS") ? 30_000 : false;
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

  // ── 재요청 뮤테이션 ────────────────────────────────────────────────────────
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

  return (
    <div style={{ padding: "20px 24px" }}>
      {/* ── 헤더 타이틀 ──────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text-primary)" }}>
            AI 태스크 목록
          </div>
        </div>
      </div>

      {/* ── 필터 영역 AR-00086 ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          style={{ ...filterSelectStyle, width: 140 }}
        >
          <option value="">상태 전체</option>
          <option value="PENDING">대기</option>
          <option value="IN_PROGRESS">처리중</option>
          <option value="DONE">완료</option>
          <option value="APPLIED">반영됨</option>
          <option value="REJECTED">반려</option>
          <option value="FAILED">실패</option>
          <option value="TIMEOUT">시간초과</option>
        </select>

        <select
          value={filterTaskType}
          onChange={(e) => setFilterTaskType(e.target.value)}
          style={{ ...filterSelectStyle, width: 140 }}
        >
          <option value="">유형 전체</option>
          <option value="INSPECT">명세 검토</option>
          <option value="DESIGN">설계</option>
          <option value="IMPLEMENT">구현 가이드</option>
          <option value="MOCKUP">목업</option>
          <option value="IMPACT">영향도 분석</option>
          <option value="CUSTOM">자유 요청</option>
        </select>

        <select
          value={filterRefType}
          onChange={(e) => setFilterRefType(e.target.value)}
          style={{ ...filterSelectStyle, width: 140 }}
        >
          <option value="">대상 전체</option>
          <option value="AREA">영역</option>
          <option value="FUNCTION">기능</option>
        </select>
        
        <div style={{ flex: 1 }} />
      </div>

      {/* 총 건수 */}
      <div style={{ marginBottom: 16, fontSize: 14, color: "var(--color-text-secondary)" }}>
        총 {totalCount}건
      </div>

      {/* ── 목록 그리드 AR-00087 ───────────────────────────────────────────── */}
      {isLoading ? (
        <div style={{ padding: "40px 32px", color: "#888" }}>불러오는 중...</div>
      ) : items.length === 0 ? (
        <div style={{ padding: "60px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
          AI 태스크가 없습니다.
        </div>
      ) : (
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
          {/* 헤더 행 */}
          <div style={gridHeaderStyle}>
            <div>요청 유형</div>
            <div>대상</div>
            <div>상태</div>
            <div>요청일시</div>
            <div>액션</div>
          </div>

          {/* 데이터 행 */}
          {items.map((row, idx) => (
            <div
              key={row.taskId}
              style={{
                ...gridRowStyle,
                borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
              }}
            >
              {/* 요청 유형 */}
              <div>
                <span className={TASK_TYPE_COLORS[row.taskType]}>
                  {TASK_TYPE_LABELS[row.taskType]}
                </span>
                {row.refType === "AREA" ? (
                  <span className="sp-badge sp-badge--neutral" style={{ marginLeft: 4 }}>영역</span>
                ) : (
                  <span className="sp-badge sp-badge--info" style={{ marginLeft: 4 }}>기능</span>
                )}
              </div>

              {/* 대상 (링크) */}
              <div>
                <button
                  style={linkBtnStyle}
                  onClick={() => navigateToRef(row)}
                  type="button"
                >
                  {row.refDisplayId && (
                    <span style={{ color: "var(--color-text-secondary)", fontSize: 12, marginRight: 6 }}>
                      {row.refDisplayId}
                    </span>
                  )}
                  {row.refName}
                </button>
              </div>

              {/* 상태 */}
              <div>
                <span className={STATUS_COLORS[row.status]}>
                  {STATUS_LABELS[row.status]}
                </span>
                {row.status === "IN_PROGRESS" && (
                  <span style={{ color: "var(--color-text-secondary)", marginLeft: 6, fontSize: 12 }}>
                    {formatElapsed(row.elapsedMs)}
                  </span>
                )}
              </div>

              {/* 요청일시 */}
              <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                {formatDatetime(row.requestedAt)}
              </div>

              {/* 액션 */}
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {/* DONE → 결과 확인 버튼 */}
                {row.status === "DONE" && (
                  <button
                    style={primaryBtnStyle}
                    onClick={() => setResultPopupTaskId(row.taskId)}
                    type="button"
                  >
                    결과 확인
                  </button>
                )}

                {/* APPLIED → 반영완료 텍스트 */}
                {row.status === "APPLIED" && (
                  <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>반영완료</span>
                )}

                {/* FAILED/REJECTED/TIMEOUT → 재요청 버튼 */}
                {["FAILED", "REJECTED", "TIMEOUT"].includes(row.status) && (
                  <button
                    style={secondaryBtnStyle}
                    onClick={() => retryMutation.mutate(row.taskId)}
                    disabled={retryMutation.isPending}
                    type="button"
                  >
                    재요청
                  </button>
                )}

                {/* IN_PROGRESS + 좀비 → 강제 취소 버튼 */}
                {row.status === "IN_PROGRESS" && row.isZombie && (
                  <button
                    style={dangerBtnStyle}
                    onClick={() => setCancelConfirmId(row.taskId)}
                    type="button"
                  >
                    강제 취소
                  </button>
                )}

                {/* IN_PROGRESS + 정상 처리중 → 텍스트 */}
                {row.status === "IN_PROGRESS" && !row.isZombie && (
                  <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>처리중...</span>
                )}

                {/* PENDING → 대기중 */}
                {row.status === "PENDING" && (
                  <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>대기중</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── 강제 취소 확인 다이얼로그 ─────────────────────────────────────────── */}
      {cancelConfirmId && (
        <CancelConfirmDialog
          onConfirm={() => cancelMutation.mutate(cancelConfirmId)}
          onClose={() => setCancelConfirmId(null)}
          isPending={cancelMutation.isPending}
        />
      )}

      {/* ── AI 결과 확인 팝업 PID-00056 ───────────────────────────────────────── */}
      {resultPopupTaskId && (
        <ResultPopup
          projectId={projectId}
          taskId={resultPopupTaskId}
          onClose={() => setResultPopupTaskId(null)}
          onApplied={() => {
            setResultPopupTaskId(null);
            queryClient.invalidateQueries({ queryKey: ["ai-tasks", projectId] });
          }}
          onRejected={() => {
            setResultPopupTaskId(null);
            queryClient.invalidateQueries({ queryKey: ["ai-tasks", projectId] });
          }}
        />
      )}
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

// ── AI 결과 확인 팝업 (PID-00056) ─────────────────────────────────────────────

function ResultPopup({
  projectId,
  taskId,
  onClose,
  onApplied,
  onRejected,
}: {
  projectId:  string;
  taskId:     string;
  onClose:    () => void;
  onApplied:  () => void;
  onRejected: () => void;
}) {
  const [rejectReason, setRejectReason] = useState("");
  const [rejectMode,   setRejectMode]   = useState(false);

  // ── 상세 조회 FID-00186 ─────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ["ai-task-detail", projectId, taskId],
    queryFn:  () =>
      authFetch<{ data: TaskDetail }>(
        `/api/projects/${projectId}/ai-tasks/${taskId}`
      ).then((r) => r.data),
  });

  const detail = data;

  // ── 반영 뮤테이션 FID-00187 ─────────────────────────────────────────────────
  const applyMutation = useMutation<{ data: { taskId: string } }, Error, void>({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/ai-tasks/${taskId}/apply`, { method: "POST" }),
    onSuccess: () => {
      toast.success("결과가 반영되었습니다.");
      onApplied();
    },
    onError: (err) => toast.error(err.message),
  });

  // ── 반려 뮤테이션 FID-00188 ─────────────────────────────────────────────────
  const rejectMutation = useMutation<{ data: { taskId: string } }, Error, string>({
    mutationFn: (reason) =>
      authFetch(`/api/projects/${projectId}/ai-tasks/${taskId}/reject`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ rejectReason: reason }),
      }),
    onSuccess: () => {
      toast.success("태스크가 반려되었습니다.");
      onRejected();
    },
    onError: (err) => toast.error(err.message),
  });

  function handleReject() {
    if (!rejectReason.trim()) {
      toast.error("반려 사유를 입력해 주세요.");
      return;
    }
    rejectMutation.mutate(rejectReason.trim());
  }

  return (
    <div className="sp-modal-backdrop">
      <div className="sp-modal" style={{ width: 680, maxWidth: "90vw" }}>
        <div className="sp-modal__header">
          <h2 className="sp-modal__title">AI 태스크 결과 확인</h2>
          <button className="sp-modal__close" onClick={onClose} type="button">×</button>
        </div>

        <div className="sp-modal__body">
          {isLoading ? (
            <div className="sp-empty">불러오는 중...</div>
          ) : !detail ? (
            <div className="sp-empty">데이터를 불러올 수 없습니다.</div>
          ) : (
            <>
              {/* 태스크 메타 정보 */}
              <div className="sp-form-row" style={{ marginBottom: 16 }}>
                <div>
                  <span className="sp-label">요청 유형</span>
                  <span className={TASK_TYPE_COLORS[detail.taskType]} style={{ marginLeft: 8 }}>
                    {TASK_TYPE_LABELS[detail.taskType]}
                  </span>
                </div>
                <div style={{ marginTop: 8 }}>
                  <span className="sp-label">대상</span>
                  <span style={{ marginLeft: 8 }}>
                    {detail.refDisplayId && (
                      <span className="sp-text--muted">{detail.refDisplayId} </span>
                    )}
                    {detail.refName}
                    <span className="sp-text--muted" style={{ marginLeft: 4 }}>
                      ({detail.refType === "AREA" ? "영역" : "기능"})
                    </span>
                  </span>
                </div>
                <div style={{ marginTop: 8 }}>
                  <span className="sp-label">요청일시</span>
                  <span className="sp-text--muted" style={{ marginLeft: 8 }}>
                    {formatDatetime(detail.requestedAt)}
                  </span>
                </div>
              </div>

              <hr style={{ margin: "12px 0", borderColor: "var(--color-border-default)" }} />

              {/* AI 결과 (마크다운 렌더링 영역) */}
              <div className="sp-label" style={{ marginBottom: 8 }}>AI 결과</div>
              <div
                className="sp-markdown-view"
                style={{
                  background:   "var(--color-surface-sunken)",
                  borderRadius: "var(--radius-md)",
                  padding:      "var(--space-4)",
                  minHeight:    160,
                  maxHeight:    340,
                  overflowY:    "auto",
                  whiteSpace:   "pre-wrap",
                  fontFamily:   "inherit",
                  fontSize:     13,
                  lineHeight:   1.6,
                }}
              >
                {detail.resultCn || (
                  <span className="sp-text--muted">결과 내용이 없습니다.</span>
                )}
              </div>

              {/* 반려 사유 입력 */}
              {rejectMode && (
                <div style={{ marginTop: 16 }}>
                  <label className="sp-label">반려 사유 (필수)</label>
                  <textarea
                    className="sp-textarea"
                    rows={3}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="반려 사유를 입력해 주세요."
                    style={{ marginTop: 6 }}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <div className="sp-modal__footer">
          <button className="sp-btn sp-btn--secondary" onClick={onClose} type="button">
            닫기
          </button>

          {/* 반려 모드 진입 / 실행 */}
          {!rejectMode ? (
            <button
              className="sp-btn sp-btn--secondary"
              onClick={() => setRejectMode(true)}
              disabled={!detail || applyMutation.isPending}
              type="button"
            >
              반려
            </button>
          ) : (
            <>
              <button
                className="sp-btn sp-btn--secondary"
                onClick={() => { setRejectMode(false); setRejectReason(""); }}
                type="button"
              >
                취소
              </button>
              <button
                className="sp-btn sp-btn--warning"
                onClick={handleReject}
                disabled={rejectMutation.isPending}
                type="button"
              >
                {rejectMutation.isPending ? "처리중..." : "반려 확인"}
              </button>
            </>
          )}

          {/* 반영 버튼 — 반려 모드가 아닐 때만 표시 */}
          {!rejectMode && (
            <button
              className="sp-btn sp-btn--primary"
              onClick={() => applyMutation.mutate()}
              disabled={!detail || applyMutation.isPending}
              type="button"
            >
              {applyMutation.isPending ? "처리중..." : "반영"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

const GRID_TEMPLATE = "180px 1fr 140px 140px 160px";

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

const dangerBtnStyle: React.CSSProperties = {
  padding:      "6px 14px",
  borderRadius: 4,
  border:       "1px solid #e53935",
  background:   "transparent",
  color:        "#e53935",
  fontSize:     13,
  cursor:       "pointer",
};
