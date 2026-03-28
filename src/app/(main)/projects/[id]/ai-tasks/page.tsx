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

  // ── 재실행 뮤테이션 (상태 무관 — 새 PENDING 태스크 생성) ─────────────────
  const rerunMutation = useMutation<{ data: { taskId: string } }, Error, string>({
    mutationFn: (taskId) =>
      authFetch(`/api/projects/${projectId}/ai-tasks/${taskId}/rerun`, { method: "POST" }),
    onSuccess: () => {
      toast.success("재실행 요청이 접수되었습니다.");
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
      <div>
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
                <div>요청 구분</div>
                <div>작업유형</div>
                <div>대상</div>
                <div>요청시각</div>
                <div>완료시각</div>
                <div>소요</div>
                <div>상태 / 액션</div>
                <div />
              </div>

              {/* 데이터 행 */}
              {items.map((row, idx) => (
                <div
                  key={row.taskId}
                  onClick={() => setSelectedTaskId(row.taskId === selectedTaskId ? null : row.taskId)}
                  style={{
                    ...gridRowStyle,
                    borderTop:   idx === 0 ? "none" : "1px solid var(--color-border)",
                    cursor:      "pointer",
                    background:  row.taskId === selectedTaskId
                      ? "var(--color-brand-subtle, #e8f0fe)"
                      : "var(--color-bg-card)",
                    borderLeft:  row.taskId === selectedTaskId
                      ? "3px solid var(--color-brand, #1976d2)"
                      : "3px solid transparent",
                  }}
                >
                  {/* 단계 (기능/영역) */}
                  <div>
                    {row.refType === "AREA"
                      ? <span className="sp-badge sp-badge--neutral">영역</span>
                      : <span className="sp-badge sp-badge--info">기능</span>
                    }
                  </div>

                  {/* 요청 구분 (설계/명세검토 등) */}
                  <div>
                    <span className={TASK_TYPE_COLORS[row.taskType]}>
                      {TASK_TYPE_LABELS[row.taskType]}
                    </span>
                  </div>

                  {/* 대상 (링크) */}
                  <div>
                    <button
                      style={linkBtnStyle}
                      onClick={(e) => { e.stopPropagation(); navigateToRef(row); }}
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

                  {/* 요청시각 */}
                  <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                    {formatDatetime(row.requestedAt)}
                  </div>

                  {/* 완료시각 */}
                  <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                    {row.completedAt ? formatDatetime(row.completedAt) : (
                      row.status === "IN_PROGRESS"
                        ? <span style={{ color: "var(--color-primary, #1976d2)", fontSize: 12 }}>{formatElapsed(row.elapsedMs)}</span>
                        : <span style={{ color: "#bbb" }}>-</span>
                    )}
                  </div>

                  {/* 소요 */}
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", textAlign: "right" }}>
                    {formatDuration(row.requestedAt, row.completedAt)}
                  </div>

                  {/* 상태 + 액션 (통합) */}
                  <div
                    style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className={STATUS_COLORS[row.status]}>
                      {STATUS_LABELS[row.status]}
                    </span>

                    {/* DONE → 결과 확인 버튼 */}
                    {row.status === "DONE" && (
                      <button
                        style={{ ...primaryBtnStyle, fontSize: 12, padding: "4px 10px" }}
                        onClick={() => setResultPopupTaskId(row.taskId)}
                        type="button"
                      >
                        결과 확인
                      </button>
                    )}

                    {/* FAILED/REJECTED/TIMEOUT → 재요청 아이콘 버튼 */}
                    {["FAILED", "REJECTED", "TIMEOUT"].includes(row.status) && (
                      <button
                        title="재요청"
                        style={{ background: "none", border: "1px solid var(--color-border)", borderRadius: 4, cursor: "pointer", fontSize: 16, padding: "2px 7px", color: "var(--color-text-secondary)", lineHeight: 1 }}
                        onClick={() => retryMutation.mutate(row.taskId)}
                        disabled={retryMutation.isPending}
                        type="button"
                      >
                        ↺
                      </button>
                    )}

                    {/* IN_PROGRESS + 좀비 → 강제 취소 버튼 */}
                    {row.status === "IN_PROGRESS" && row.isZombie && (
                      <button
                        style={{ ...dangerBtnStyle, fontSize: 12, padding: "4px 10px" }}
                        onClick={() => setCancelConfirmId(row.taskId)}
                        type="button"
                      >
                        강제 취소
                      </button>
                    )}
                  </div>

                  {/* 재실행 아이콘 — IN_PROGRESS 제외 모든 상태 */}
                  <div
                    style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {row.status !== "IN_PROGRESS" && (
                      <button
                        title="재실행 (새 대기 태스크 생성)"
                        onClick={() => rerunMutation.mutate(row.taskId)}
                        disabled={rerunMutation.isPending}
                        type="button"
                        style={{
                          background: "none",
                          border:     "1px solid var(--color-border)",
                          borderRadius: 4,
                          cursor:     "pointer",
                          fontSize:   16,
                          padding:    "2px 7px",
                          color:      "var(--color-text-secondary)",
                          lineHeight: 1,
                        }}
                      >
                        ↺
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      {/* ── 상세 모달 — row 선택 시 표시 */}
      {selectedTaskId && (
        <TaskDetailPanel
          projectId={projectId}
          taskId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
        />
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

// ── 상세 모달 ─────────────────────────────────────────────────────────────────

function TaskDetailPanel({
  projectId,
  taskId,
  onClose,
}: {
  projectId: string;
  taskId:    string;
  onClose:   () => void;
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
          width:        "min(900px, 92vw)",
          maxHeight:    "85vh",
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
              <span style={{ marginLeft: 10, fontSize: 12, color: "var(--color-text-secondary)", fontFamily: "monospace" }}>
                {data.taskId}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--color-text-secondary)", lineHeight: 1 }}
            type="button"
          >
            ×
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
            {/* 메타 정보 */}
            <div
              style={{
                padding:      "12px 20px",
                borderBottom: "1px solid var(--color-border)",
                display:      "flex",
                flexWrap:     "wrap",
                gap:          10,
                alignItems:   "center",
                flexShrink:   0,
              }}
            >
              <span className={TASK_TYPE_COLORS[data.taskType]}>{TASK_TYPE_LABELS[data.taskType]}</span>
              <span className={STATUS_COLORS[data.status]}>{STATUS_LABELS[data.status]}</span>
              <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                {data.refDisplayId && <>{data.refDisplayId} — </>}{data.refName}
                <span style={{ marginLeft: 6 }}>({data.refType === "AREA" ? "영역" : "기능"})</span>
              </span>
              <span style={{ fontSize: 13, color: "var(--color-text-secondary)", marginLeft: "auto" }}>
                요청: {formatDatetime(data.requestedAt)}
                {data.completedAt && <> &nbsp;·&nbsp; 완료: {formatDatetime(data.completedAt)}</>}
              </span>
            </div>

            {/* 좌: 요청 Spec / 우: 응답 피드백 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", flex: 1, minHeight: 0 }}>
              {/* 요청 Spec */}
              <div
                style={{
                  padding:     "16px 20px",
                  borderRight: "1px solid var(--color-border)",
                  overflowY:   "auto",
                }}
              >
                <div style={panelLabelStyle}>요청 Spec</div>
                <div style={panelBodyStyle}>
                  {data.comment || <span style={{ color: "#aaa" }}>내용 없음</span>}
                </div>
              </div>

              {/* 응답 피드백 */}
              <div style={{ padding: "16px 20px", overflowY: "auto" }}>
                <div style={panelLabelStyle}>응답 피드백</div>
                <div style={panelBodyStyle}>
                  {data.resultCn || <span style={{ color: "#aaa" }}>결과 없음</span>}
                </div>
              </div>
            </div>

            {/* 반려 사유 (있을 경우) */}
            {data.rejectReason && (
              <div
                style={{
                  padding:     "12px 20px",
                  borderTop:   "1px solid var(--color-border)",
                  background:  "var(--color-bg-muted)",
                  flexShrink:  0,
                }}
              >
                <div style={panelLabelStyle}>반려 사유</div>
                <div style={{ ...panelBodyStyle, color: "#e53935" }}>{data.rejectReason}</div>
              </div>
            )}

            {/* 하단 액션 바 */}
            <div
              style={{
                display:        "flex",
                alignItems:     "center",
                justifyContent: "space-between",
                padding:        "12px 20px",
                borderTop:      "1px solid var(--color-border)",
                background:     "var(--color-bg-muted)",
                flexShrink:     0,
                gap:            12,
              }}
            >
              {/* 왼쪽: 삭제 버튼 */}
              <button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (window.confirm("이 AI 태스크를 삭제하시겠습니까?")) {
                    deleteMutation.mutate();
                  }
                }}
                style={{ ...dangerBtnStyle, fontSize: 13, padding: "6px 16px" }}
              >
                삭제
              </button>

              {/* 오른쪽: 상태 콤보박스 */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>상태</span>
                <select
                  value={data.status}
                  disabled={statusMutation.isPending}
                  onChange={(e) => statusMutation.mutate(e.target.value)}
                  style={{
                    padding:      "6px 28px 6px 10px",
                    borderRadius: 6,
                    border:       "1px solid var(--color-border)",
                    background:   "var(--color-bg-card)",
                    color:        "var(--color-text-primary)",
                    fontSize:     13,
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
            </div>
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

const GRID_TEMPLATE = "60px 120px 280px 120px 120px 90px 1fr 48px";

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
  maxHeight:  320,
  overflowY:  "auto",
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
