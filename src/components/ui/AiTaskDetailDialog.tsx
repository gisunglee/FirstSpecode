"use client";

/**
 * AiTaskDetailDialog — AI 태스크 상세 팝업 (재사용 컴포넌트)
 *
 * 역할:
 *   - AI 태스크 결과 확인 (요청 SPEC / 응답 피드백)
 *   - 결과 반영 / 반려 / 상태 변경 / 삭제
 *   - ai-tasks 목록 페이지, 기능 정의 페이지 등 여러 곳에서 호출 가능
 *
 * Props:
 *   - projectId: 프로젝트 ID
 *   - taskId:    AI 태스크 ID
 *   - onClose:   닫기 콜백
 *   - onApplied: 반영 완료 후 콜백 (optional)
 *   - onRejected: 반려 완료 후 콜백 (optional)
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import MarkdownEditor from "@/components/ui/MarkdownEditor";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type TaskStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "APPLIED" | "REJECTED" | "FAILED" | "TIMEOUT";
type TaskType   = "INSPECT" | "DESIGN" | "IMPLEMENT" | "MOCKUP" | "IMPACT" | "CUSTOM";
type RefType    = "AREA" | "FUNCTION";

type TaskDetail = {
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
  rejectReason: string;
  requestedAt:  string;
  completedAt:  string | null;
  appliedAt:    string | null;
  reqMberId?:   string;
  reqMberName?: string;
  retryCnt?:    number;
  execAvlblDt?: string | null;
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

// ── 배지 스타일 ───────────────────────────────────────────────────────────────

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
    display: "inline-block", padding: "2px 8px", borderRadius: 4,
    fontSize: 11, fontWeight: 700,
    background: c.bg, color: c.color, border: `1px solid ${c.color}20`,
  };
}

function taskTypeBadgeStyle(type: TaskType): React.CSSProperties {
  const colors: Record<TaskType, { bg: string; color: string }> = {
    INSPECT:   { bg: "#f5f5f5",  color: "#616161" },
    DESIGN:    { bg: "#e8eaf6",  color: "#3f51b5" },
    IMPLEMENT: { bg: "#e1f5fe",  color: "#0288d1" },
    MOCKUP:    { bg: "#f1f8e9",  color: "#558b2f" },
    IMPACT:    { bg: "#fff3e0",  color: "#ef6c00" },
    CUSTOM:    { bg: "#f5f5f5",  color: "#757575" },
  };
  const c = colors[type] ?? { bg: "#f5f5f5", color: "#555" };
  return {
    display: "inline-block", padding: "2px 8px", borderRadius: 4,
    fontSize: 11, fontWeight: 700, background: c.bg, color: c.color,
  };
}

// ── 유틸 ──────────────────────────────────────────────────────────────────────

function formatDatetime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ── 컴포넌트 ──────────────────────────────────────────────────────────────────

export default function AiTaskDetailDialog({
  projectId,
  taskId,
  onClose,
  onApplied,
  onRejected,
}: {
  projectId:   string;
  taskId:      string;
  onClose:     () => void;
  onApplied?:  () => void;
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

  // ── 상태 탭 ────────────────────────────────────────────────────────────────
  const [reqTab,    setReqTab]           = useState<"edit" | "preview">("preview");
  const [resultTab, setResultTab]        = useState<"edit" | "preview">("preview");
  const [rejectTab, setResultRejectTab]  = useState<"edit" | "preview">("preview");
  const [rejectMode,   setRejectMode]    = useState(false);
  const [rejectReason, setRejectReason]  = useState("");

  // ── 뮤테이션 ───────────────────────────────────────────────────────────────
  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      authFetch(`/api/projects/${projectId}/ai-tasks/${taskId}`, {
        method: "PATCH", body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      toast.success("상태가 수정되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["ai-task-detail", projectId, taskId] });
      queryClient.invalidateQueries({ queryKey: ["ai-tasks", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

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

  const applyMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/ai-tasks/${taskId}/apply`, { method: "POST" }),
    onSuccess: () => {
      toast.success("결과가 반영되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["ai-tasks", projectId] });
      if (onApplied) onApplied(); else onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rejectMutation = useMutation({
    mutationFn: (reason: string) =>
      authFetch(`/api/projects/${projectId}/ai-tasks/${taskId}/reject`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rejectReason: reason }),
      }),
    onSuccess: () => {
      toast.success("태스크가 반려되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["ai-tasks", projectId] });
      if (onRejected) onRejected(); else onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleReject() {
    if (!rejectReason.trim()) { toast.error("반려 사유를 입력해 주세요."); return; }
    rejectMutation.mutate(rejectReason.trim());
  }

  // ── 로컬 탭 버튼 ─────────────────────────────────────────────────────────
  function LocalTabButtons({ tab, onTabChange }: { tab: "edit" | "preview"; onTabChange: (t: "edit" | "preview") => void }) {
    return (
      <div style={{ display: "flex", gap: 2, background: "var(--color-bg-muted)", padding: "3px", borderRadius: 7 }}>
        {(["preview", "edit"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onTabChange(t)}
            style={{
              padding: "4px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
              borderRadius: 5, border: "none", transition: "all 0.15s",
              background: tab === t ? "var(--color-primary, #1976d2)" : "transparent",
              color: tab === t ? "#fff" : "var(--color-text-secondary)",
            }}
          >
            {t === "preview" ? "미리보기" : "원문"}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1340px, 95vw)", height: "85vh",
          display: "flex", flexDirection: "column",
          border: "1px solid var(--color-border)", borderRadius: 10,
          background: "var(--color-bg-card)", boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        {/* 헤더 */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: "1px solid var(--color-border)",
          background: "var(--color-bg-muted)", flexShrink: 0,
        }}>
          <div>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>
              AI 태스크 상세
            </span>
            {data && (
              <span style={{
                fontSize: 10, fontFamily: '"JetBrains Mono", "Roboto Mono", monospace',
                color: "var(--color-text-secondary)", marginLeft: 12, opacity: 0.5, letterSpacing: "0.02em",
              }}>
                {data.taskId}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              padding: "5px 12px", background: "var(--color-bg-muted)",
              border: "1px solid var(--color-border)", borderRadius: 4,
              fontSize: 12, fontWeight: 600, cursor: "pointer",
              color: "var(--color-text-primary)", transition: "all 0.2s ease",
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = "#ececec")}
            onMouseOut={(e)  => (e.currentTarget.style.background = "var(--color-bg-muted)")}
          >
            닫기
          </button>
        </div>

        {isLoading ? (
          <div style={{ padding: "48px", textAlign: "center", color: "#aaa", fontSize: 13 }}>불러오는 중...</div>
        ) : !data ? (
          <div style={{ padding: "48px", textAlign: "center", color: "#aaa", fontSize: 13 }}>데이터를 불러올 수 없습니다.</div>
        ) : (
          <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
            {/* 메타 정보 */}
            <div style={{
              padding: "10px 20px", borderBottom: "1px solid var(--color-border)",
              display: "flex", alignItems: "center", gap: "24px",
              flexWrap: "wrap", background: "var(--color-bg-card)", flexShrink: 0,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={taskTypeBadgeStyle(data.taskType)}>{TASK_TYPE_LABELS[data.taskType]}</span>
                <span style={statusBadgeStyle(data.status)}>{STATUS_LABELS[data.status]}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
                  {data.refDisplayId && (
                    <span style={{ fontSize: 15, fontWeight: 600, color: "var(--color-primary)" }}>{data.refDisplayId}</span>
                  )}
                  <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)" }}>{data.refName}</span>
                </div>
              </div>

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

              {/* 액션 버튼 */}
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
                {data.status === "DONE" && (
                  <div style={{ display: "flex", gap: 8 }}>
                    {!rejectMode ? (
                      <>
                        <button onClick={() => setRejectMode(true)} style={{ ...secondaryBtnStyle, padding: "5px 12px", fontSize: 12 }}>반려</button>
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
                        <button onClick={() => { setRejectMode(false); setRejectReason(""); }} style={{ ...secondaryBtnStyle, padding: "5px 12px", fontSize: 12 }}>취소</button>
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

                {!rejectMode && data.status !== "DONE" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>상태 변경</span>
                    <select
                      value={data.status}
                      disabled={statusMutation.isPending}
                      onChange={(e) => statusMutation.mutate(e.target.value)}
                      style={{
                        padding: "4px 28px 4px 10px", borderRadius: 6,
                        border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
                        color: "var(--color-text-primary)", fontSize: 12, cursor: "pointer",
                        appearance: "none",
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                        backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center",
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

            {/* 요청 SPEC / 응답 피드백 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", flex: 1, minHeight: 0, borderTop: "1px solid var(--color-border)" }}>
              <div style={{
                padding: "12px 20px", borderRight: "1px solid var(--color-border)",
                display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexShrink: 0 }}>
                  <span style={panelLabelStyle}>요청 SPEC</span>
                  <LocalTabButtons tab={reqTab} onTabChange={setReqTab} />
                </div>
                <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
                  <MarkdownEditor
                    value={[data.comment, data.reqCn ? `\n\n---\n\n${data.reqCn}` : ""].filter(Boolean).join("")}
                    onChange={() => {}}
                    readOnly tab={reqTab} onTabChange={setReqTab} fullHeight
                  />
                </div>
              </div>

              <div style={{
                padding: "12px 20px", display: "flex", flexDirection: "column",
                overflow: "hidden", minHeight: 0,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexShrink: 0 }}>
                  <span style={panelLabelStyle}>응답 피드백</span>
                  <LocalTabButtons tab={resultTab} onTabChange={setResultTab} />
                </div>
                <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
                  <MarkdownEditor
                    value={data.resultCn || ""}
                    onChange={() => {}}
                    readOnly tab={resultTab} onTabChange={setResultTab} fullHeight
                    placeholder="결과 데이터가 없습니다."
                  />
                </div>
              </div>
            </div>

            {/* 반려 사유 */}
            {rejectMode ? (
              <div style={{ padding: "12px 20px", borderTop: "1px solid var(--color-border)", background: "#fff9f9", flexShrink: 0 }}>
                <div style={panelLabelStyle}>반려 사유 (필수)</div>
                <MarkdownEditor value={rejectReason} onChange={setRejectReason} placeholder="반려 사유를 입력해 주세요." rows={4} />
              </div>
            ) : data.rejectReason ? (
              <div style={{
                padding: "12px 20px", borderTop: "1px solid var(--color-border)",
                background: "var(--color-bg-muted)", flexShrink: 0,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={panelLabelStyle}>반려 사유</span>
                  <LocalTabButtons tab={rejectTab} onTabChange={setResultRejectTab} />
                </div>
                <MarkdownEditor value={data.rejectReason} onChange={() => {}} readOnly tab={rejectTab} onTabChange={setResultRejectTab} rows={3} />
              </div>
            ) : null}

            <div style={{ height: 10 }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── 스타일 상수 ───────────────────────────────────────────────────────────────

const primaryBtnStyle: React.CSSProperties = {
  padding: "6px 14px", borderRadius: 4, border: "none",
  background: "var(--color-primary, #1976d2)", color: "#fff",
  fontSize: 13, fontWeight: 600, cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "6px 14px", borderRadius: 4,
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-primary)", fontSize: 13, cursor: "pointer",
};

const dangerBtnStyle: React.CSSProperties = {
  padding: "6px 14px", borderRadius: 4,
  border: "1px solid #e53935", background: "transparent",
  color: "#e53935", fontSize: 13, cursor: "pointer",
};

const panelLabelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: "uppercase",
  letterSpacing: "0.05em", color: "var(--color-text-secondary)", marginBottom: 6,
};
