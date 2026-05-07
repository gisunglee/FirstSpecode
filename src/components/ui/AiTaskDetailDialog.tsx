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
 *   - onRejected: 반려 완료 후 콜백 (optional)
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import MarkdownEditor from "@/components/ui/MarkdownEditor";
import AiTaskAttachmentsDialog from "@/components/ui/AiTaskAttachmentsDialog";
import {
  type AiTaskStatus, type AiTaskType, type AiRefType,
  AI_TASK_STATUS_LABEL, AI_TASK_STATUS_BADGE, AI_TASK_TYPE_LABEL,
} from "@/constants/codes";

// ── 타입 ──────────────────────────────────────────────────────────────────────
// 공용 codes 모듈에서 타입 import — 로컬 중복 정의 제거.
// 단, tb_ai_task.task_ty_code 는 두 도메인이 섞인 컬럼이라 (codes.ts 주석 참조)
// 상세 다이얼로그도 일반 AiTaskType + Plan Studio 산출물(IA/JOURNEY/FLOW/ERD/PROCESS)
// 양쪽을 모두 표시할 수 있어야 한다. ai-tasks 목록 페이지의 TASK_TYPE_LABELS 와 동일한 패턴.
type PlanStudioArtfType = "IA" | "JOURNEY" | "FLOW" | "ERD" | "PROCESS";
type ExtendedTaskType   = AiTaskType | PlanStudioArtfType;

const PLAN_STUDIO_ARTF_LABEL: Record<PlanStudioArtfType, string> = {
  IA:      "정보구조도",
  JOURNEY: "사용자여정",
  FLOW:    "화면흐름",
  ERD:     "ERD",
  PROCESS: "업무프로세스",
};

const EXTENDED_TASK_TYPE_LABEL: Record<ExtendedTaskType, string> = {
  ...AI_TASK_TYPE_LABEL,
  ...PLAN_STUDIO_ARTF_LABEL,
};

type TaskDetail = {
  taskId:       string;
  taskType:     ExtendedTaskType;
  refType:      AiRefType;
  refId:        string;
  refName:      string;
  refDisplayId: string;
  status:       AiTaskStatus;
  comment:      string;
  reqCn:        string;
  resultCn:     string;
  rejectReason: string;
  requestedAt:  string;
  completedAt:  string | null;
  appliedAt:    string | null;
  reqMberId?:   string;
  reqMberName?: string;
  myMberId?:    string;
  myRole?:      string;
  retryCnt?:    number;
  execAvlblDt?: string | null;
  parentTaskId?: string | null;
  // 서버(ai-tasks/[taskId] GET)에서 내려주는 첨부파일 개수
  // "첨부 자료 보기" 버튼 노출 판단에만 사용 — 실제 목록은 모달이 별도 조회
  attachmentCount?: number;
};

// ── 배지 스타일 ───────────────────────────────────────────────────────────────
// 상태 라벨·색상은 공용 codes 모듈에서 가져옴 (AI_TASK_STATUS_LABEL, AI_TASK_STATUS_BADGE)
// 태스크 타입 배지 색상은 이 파일 전용이므로 로컬 유지 (공용화는 아직 불필요)

function statusBadgeStyle(status: AiTaskStatus): React.CSSProperties {
  const c = AI_TASK_STATUS_BADGE[status] ?? { bg: "#f5f5f5", fg: "#555" };
  return {
    display: "inline-block", padding: "2px 8px", borderRadius: 4,
    fontSize: 11, fontWeight: 700,
    background: c.bg, color: c.fg, border: `1px solid ${c.fg}20`,
  };
}

function taskTypeBadgeStyle(type: ExtendedTaskType): React.CSSProperties {
  // 일반 AiTaskType 7개 + Plan Studio 산출물 5개 모두 대응
  // Plan Studio 산출물은 보랏빛 톤으로 일반 작업과 시각적으로 구분
  const colors: Record<ExtendedTaskType, { bg: string; color: string }> = {
    INSPECT:   { bg: "#f5f5f5",  color: "#616161" },
    DESIGN:    { bg: "#e8eaf6",  color: "#3f51b5" },
    IMPLEMENT: { bg: "#fce4ec",  color: "#c62828" },
    MOCKUP:    { bg: "#f1f8e9",  color: "#558b2f" },
    IMPACT:    { bg: "#fff3e0",  color: "#ef6c00" },
    CUSTOM:    { bg: "#f5f5f5",  color: "#757575" },
    PRE_IMPL:  { bg: "#e0f7fa",  color: "#00838f" },
    IA:        { bg: "#ede7f6",  color: "#5e35b1" },
    JOURNEY:   { bg: "#ede7f6",  color: "#5e35b1" },
    FLOW:      { bg: "#ede7f6",  color: "#5e35b1" },
    ERD:       { bg: "#ede7f6",  color: "#5e35b1" },
    PROCESS:   { bg: "#ede7f6",  color: "#5e35b1" },
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
  onRejected,
}: {
  projectId:   string;
  taskId:      string;
  onClose:     () => void;
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

  // 첨부 자료 보기 모달 — 버튼은 attachmentCount > 0 일 때만 노출
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);

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
      // 상태 변경 시에도 상세 페이지 도트 색상·레이블이 즉시 반영되도록 무효화
      if (data?.refType === "AREA") {
        queryClient.invalidateQueries({ queryKey: ["area", projectId, data.refId] });
      } else if (data?.refType === "FUNCTION") {
        queryClient.invalidateQueries({ queryKey: ["function", projectId, data.refId] });
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/ai-tasks/${taskId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      // AI 태스크 목록 캐시 무효화
      queryClient.invalidateQueries({ queryKey: ["ai-tasks", projectId] });
      // 삭제한 태스크가 속한 엔티티(영역/기능) 상세 캐시도 무효화
      // — 무효화하지 않으면 상세 페이지에 '내용·재요청·☰' 버튼이 잔류함
      if (data?.refType === "AREA") {
        queryClient.invalidateQueries({ queryKey: ["area", projectId, data.refId] });
      } else if (data?.refType === "FUNCTION") {
        queryClient.invalidateQueries({ queryKey: ["function", projectId, data.refId] });
      }
      onClose();
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

  // ── 권한: 요청자 본인 또는 OWNER/ADMIN만 조작 가능 ───────────────────────────
  const canControl =
    data
      ? ["OWNER", "ADMIN"].includes(data.myRole ?? "") ||
        (!!data.myMberId && data.myMberId === data.reqMberId)
      : false;

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
      data-impl-overlay="detail"
      // 오버레이 클릭 시 자기만 닫고 부모 다이얼로그(예: AiTaskHistoryDialog)까지 닫히지 않도록
      // 이벤트 버블링 중단 — React 이벤트는 컴포넌트 트리를 따라 부모로 전파됨
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100,
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
            onClick={(e) => { e.stopPropagation(); onClose(); }}
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
                <span className="sp-badge" style={taskTypeBadgeStyle(data.taskType)}>{EXTENDED_TASK_TYPE_LABEL[data.taskType] ?? "알 수 없음"}</span>
                <span className="sp-badge" style={statusBadgeStyle(data.status)}>{AI_TASK_STATUS_LABEL[data.status]}</span>
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

              {/* 액션 버튼 — 본인·OWNER·ADMIN만 표시.
                  상태 변경은 모든 상태에서 동일 UI(select)로 통일.
                  과거에는 DONE 일 때만 "반려" 버튼을 따로 띄웠으나, UX 가 두 갈래로 갈려
                  사용자가 일관성을 잃는다는 피드백 → select 한 갈래로 통합. */}
              {canControl && (
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
                  {!rejectMode ? (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>상태 변경</span>
                        <select
                          value={data.status}
                          disabled={statusMutation.isPending}
                          onChange={(e) => {
                            const next = e.target.value;
                            // 반려는 사유가 필수 → 단순 PATCH 가 아닌 입력 모드로 전환해서
                            // /reject API 로 사유와 함께 처리한다.
                            if (next === "REJECTED") {
                              setRejectMode(true);
                              return;
                            }
                            statusMutation.mutate(next);
                          }}
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
                          {/* APPLIED 는 워커 complete 단계에서만 자동 전환되는 종착 상태.
                              수동 전환 경로는 계속 차단하되, 이미 APPLIED 인 레코드를 열었을 때
                              select 가 빈칸으로 보이지 않도록 현재 값일 때만 옵션을 노출한다. */}
                          {data.status === "APPLIED" && (
                            <option value="APPLIED">반영됨</option>
                          )}
                          <option value="REJECTED">반려</option>
                          <option value="FAILED">실패</option>
                          <option value="TIMEOUT">시간초과</option>
                        </select>
                      </div>

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
                    </>
                  ) : (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => { setRejectMode(false); setRejectReason(""); }} style={{ ...secondaryBtnStyle, padding: "5px 12px", fontSize: 12 }}>취소</button>
                      <button
                        onClick={handleReject}
                        disabled={rejectMutation.isPending}
                        style={{ ...primaryBtnStyle, padding: "5px 14px", fontSize: 12, background: "var(--color-warning, #f59e0b)" }}
                      >
                        {rejectMutation.isPending ? "반려 처리 중..." : "반려 확인"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 요청 SPEC / 응답 피드백 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", flex: 1, minHeight: 0, borderTop: "1px solid var(--color-border)" }}>
              <div style={{
                padding: "12px 20px", borderRight: "1px solid var(--color-border)",
                display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0,
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexShrink: 0 }}>
                  <span style={panelLabelStyle}>요청 SPEC</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {/* 첨부 자료 보기 — 요청 시 올린 이미지/파일이 있을 때만 노출 */}
                    {(data.attachmentCount ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => setAttachDialogOpen(true)}
                        title="요청 시 첨부된 이미지/파일 보기"
                        style={attachBtnStyle}
                      >
                        📎 첨부 자료 <span style={attachCountBadgeStyle}>{data.attachmentCount}</span>
                      </button>
                    )}
                    <MdActionButtons content={[data.comment, data.reqCn ? `\n\n---\n\n${data.reqCn}` : ""].filter(Boolean).join("")} filename={`요청SPEC_${data.taskId.substring(0, 8)}`} />
                    <LocalTabButtons tab={reqTab} onTabChange={setReqTab} />
                  </div>
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
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexShrink: 0 }}>
                  <span style={panelLabelStyle}>응답 피드백</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <MdActionButtons content={data.resultCn || ""} filename={`응답피드백_${data.taskId.substring(0, 8)}`} />
                    <LocalTabButtons tab={resultTab} onTabChange={setResultTab} />
                  </div>
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

        {/* 첨부 자료 보기 — 읽기 전용 모달 (공용 컴포넌트) */}
        {/* 이 다이얼로그 내부에 렌더해야 상세 다이얼로그와 함께 스택이 관리됨 */}
        {attachDialogOpen && (
          <AiTaskAttachmentsDialog
            projectId={projectId}
            taskId={taskId}
            onClose={() => setAttachDialogOpen(false)}
          />
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

// ── 첨부 자료 보기 버튼 ──────────────────────────────────────────────────────
// iconBtnStyle 과 동일 톤이지만 배지가 있어 padding·정렬을 미세 조정한 전용 스타일
const attachBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
  padding: "4px 10px", borderRadius: 5,
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)", fontSize: 11, fontWeight: 600,
  cursor: "pointer", flexShrink: 0,
};

const attachCountBadgeStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700,
  padding: "1px 6px", borderRadius: 8,
  background: "rgba(25,118,210,0.12)", color: "#1565c0",
};

// ── 복사 + 다운로드 아이콘 버튼 ──────────────────────────────────────────────

const iconBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
  padding: "4px 10px", borderRadius: 5,
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)", fontSize: 11, fontWeight: 600,
  cursor: "pointer", flexShrink: 0,
};

function MdActionButtons({ content, filename }: { content: string; filename: string }) {
  if (!content.trim()) return null;

  function handleCopy() {
    navigator.clipboard.writeText(content);
    toast.success("클립보드에 복사되었습니다.");
  }

  function handleDownload() {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <button onClick={handleCopy} title="클립보드 복사" style={iconBtnStyle}>
        <span style={{ fontSize: 12 }}>📋</span>
        <span>복사</span>
      </button>
      <button onClick={handleDownload} title="MD 파일 다운로드" style={iconBtnStyle}>
        <span style={{ fontSize: 12 }}>↓</span>
        <span>MD</span>
      </button>
    </>
  );
}
