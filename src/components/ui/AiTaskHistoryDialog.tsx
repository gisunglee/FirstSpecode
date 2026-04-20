"use client";

/**
 * AiTaskHistoryDialog — AI 태스크 이력 팝업 (재사용 컴포넌트)
 *
 * 역할:
 *   - 특정 대상(refType + refId)의 특정 작업 유형(taskType) AI 태스크 이력 조회
 *   - 목록 클릭 → AiTaskDetailDialog 팝업으로 상세 보기
 *   - 기능 정의 페이지, 영역 페이지 등 여러 곳에서 호출 가능
 *
 * Props:
 *   - projectId: 프로젝트 ID
 *   - refType:   "AREA" | "FUNCTION"
 *   - refId:     대상 ID
 *   - taskType:  "DESIGN" | "INSPECT" | "IMPACT" 등
 *   - onClose:   닫기 콜백
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import AiTaskDetailDialog from "@/components/ui/AiTaskDetailDialog";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type TaskStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "APPLIED" | "REJECTED" | "FAILED" | "TIMEOUT";
type TaskType   = "INSPECT" | "DESIGN" | "IMPLEMENT" | "PRE_IMPL" | "MOCKUP" | "IMPACT" | "CUSTOM";

type TaskRow = {
  taskId:      string;
  taskType:    TaskType;
  status:      TaskStatus;
  comment:     string;
  requestedAt: string;
  completedAt: string | null;
  reqMberName: string;
  retryCnt:    number;
  implFunctions?: { displayId: string; name: string }[];
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
  IMPLEMENT: "구현",
  PRE_IMPL:  "선 구현 적용",
  MOCKUP:    "목업",
  IMPACT:    "영향도 분석",
  CUSTOM:    "자유 요청",
};

// 작업유형별 배지 색상
const TASK_TYPE_BADGE: Record<TaskType, { bg: string; color: string }> = {
  INSPECT:   { bg: "#f5f5f5", color: "#616161" },
  DESIGN:    { bg: "#e8eaf6", color: "#3f51b5" },
  IMPLEMENT: { bg: "#fce4ec", color: "#c62828" },
  PRE_IMPL:  { bg: "#e8f5e9", color: "#2e7d32" },
  MOCKUP:    { bg: "#f1f8e9", color: "#558b2f" },
  IMPACT:    { bg: "#fff3e0", color: "#ef6c00" },
  CUSTOM:    { bg: "#f5f5f5", color: "#757575" },
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

// ── 유틸 ──────────────────────────────────────────────────────────────────────

function formatDatetime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return "—";
  const ms = Math.abs(new Date(endIso).getTime() - new Date(startIso).getTime());
  const s  = Math.floor(ms / 1000);
  if (s === 0) return "1초 미만";
  if (s < 60)  return `${s}초`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}분`;
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `${h}시간` : `${h}시간 ${m % 60}분`;
}

// ── 컴포넌트 ──────────────────────────────────────────────────────────────────

export default function AiTaskHistoryDialog({
  projectId,
  refType,
  refId,
  taskType,
  onClose,
}: {
  projectId: string;
  refType:   "AREA" | "FUNCTION" | "UNIT_WORK";
  refId:     string;
  taskType:  TaskType;
  onClose:   () => void;
}) {
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["ai-task-history", projectId, refType, refId, taskType],
    queryFn:  () => {
      const sp = new URLSearchParams({ taskType });
      // IMPLEMENT는 스냅샷 경유 조회 (여러 노드가 한 태스크에 포함될 수 있으므로)
      if (taskType === "IMPLEMENT") {
        sp.set("snapshotRefId", refId);
        sp.set("snapshotRefType", refType);
      } else {
        sp.set("refType", refType);
        sp.set("refId", refId);
      }
      return authFetch<{ data: { items: TaskRow[] } }>(
        `/api/projects/${projectId}/ai-tasks?${sp.toString()}`
      ).then((r) => r.data.items);
    },
  });

  const items = data ?? [];

  return (
    <>
      <div
        data-impl-overlay="history"
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "min(1100px, 95vw)", maxHeight: "80vh",
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
                AI 태스크 이력
              </span>
              <span style={{
                marginLeft: 10, padding: "2px 8px", borderRadius: 4,
                fontSize: 11, fontWeight: 700, background: "#e8eaf6", color: "#3f51b5",
              }}>
                {TASK_TYPE_LABELS[taskType]}
              </span>
            </div>
            <button
              onClick={onClose}
              style={{
                padding: "5px 12px", background: "var(--color-bg-muted)",
                border: "1px solid var(--color-border)", borderRadius: 4,
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                color: "var(--color-text-primary)",
              }}
            >
              닫기
            </button>
          </div>

          {/* 바디 */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {isLoading ? (
              <div style={{ padding: "40px", textAlign: "center", color: "#aaa", fontSize: 13 }}>불러오는 중...</div>
            ) : items.length === 0 ? (
              <div style={{ padding: "48px", textAlign: "center", color: "#aaa", fontSize: 14 }}>
                이력이 없습니다.
              </div>
            ) : (
              <>
                {/* 안내 문구 */}
                <div style={{
                  padding: "8px 20px", fontSize: 11, color: "var(--color-text-secondary)",
                  background: "rgba(103,80,164,0.04)", borderBottom: "1px solid var(--color-border)",
                }}>
                  💡 행을 클릭하면 요청/응답 내용을 볼 수 있습니다.
                </div>

                {/* 카드 목록 — 각 태스크 1개씩 */}
                <div style={{ padding: "8px 12px" }}>
                  {items.map((row) => {
                    const fnCount = row.implFunctions?.length ?? 0;
                    const fnNames = row.implFunctions?.map((f) => `${f.displayId} ${f.name}`).join(", ") ?? "";
                    const isPreImpl = row.taskType === "PRE_IMPL";
                    const typeBadge = TASK_TYPE_BADGE[row.taskType] ?? TASK_TYPE_BADGE.IMPLEMENT;

                    return (
                      <div
                        key={row.taskId}
                        onClick={() => setDetailTaskId(row.taskId)}
                        style={{
                          padding: "12px 14px", marginBottom: 6,
                          border: `1px solid ${isPreImpl ? "rgba(46,125,50,0.25)" : "var(--color-border)"}`,
                          borderRadius: 8,
                          background: isPreImpl ? "rgba(46,125,50,0.03)" : "var(--color-bg-card)",
                          cursor: "pointer",
                          transition: "all 0.1s",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-bg-hover, #f5f7ff)"; e.currentTarget.style.borderColor = "rgba(103,80,164,0.3)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = isPreImpl ? "rgba(46,125,50,0.03)" : "var(--color-bg-card)"; e.currentTarget.style.borderColor = isPreImpl ? "rgba(46,125,50,0.25)" : "var(--color-border)"; }}
                      >
                        {/* 1행 — 상태 + 작업유형 + 요청일시 + 완료일시/소요 + 재시도 + 요청자 */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                          <span style={statusBadgeStyle(row.status)}>{STATUS_LABELS[row.status]}</span>
                          {/* 작업유형 배지 — 구현/선 구현 적용 구분 */}
                          <span style={{
                            display: "inline-block", padding: "2px 8px", borderRadius: 4,
                            fontSize: 11, fontWeight: 700,
                            background: typeBadge.bg, color: typeBadge.color,
                            border: `1px solid ${typeBadge.color}20`,
                          }}>
                            {TASK_TYPE_LABELS[row.taskType]}
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-primary)" }}>
                            {formatDatetime(row.requestedAt)}
                          </span>
                          {/* 완료된 경우: 완료 시각 + 소요시간 표시 */}
                          {row.completedAt ? (
                            <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                              → {formatDatetime(row.completedAt)}
                              <span style={{ marginLeft: 4, color: "#2e7d32", fontWeight: 600 }}>
                                ({formatDuration(row.requestedAt, row.completedAt)})
                              </span>
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                              소요 <strong style={{ color: "var(--color-text-primary)" }}>—</strong>
                            </span>
                          )}
                          {row.retryCnt > 0 && (
                            <span style={{ fontSize: 11, color: "#e65100", fontWeight: 600 }}>
                              재시도 {row.retryCnt}회
                            </span>
                          )}
                          <span style={{ fontSize: 11, color: "var(--color-text-secondary)", marginLeft: "auto" }}>
                            👤 {row.reqMberName}
                          </span>
                        </div>

                        {/* 2행 — IMPLEMENT/PRE_IMPL: 포함 기능 */}
                        {(row.taskType === "IMPLEMENT" || isPreImpl) && fnCount > 0 && (
                          <div style={{
                            fontSize: 11, color: "var(--color-text-secondary)",
                            padding: "6px 8px", background: "var(--color-bg-muted)", borderRadius: 4,
                            marginBottom: row.comment ? 4 : 0,
                          }}>
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 3,
                              background: isPreImpl ? "rgba(46,125,50,0.12)" : "rgba(103,80,164,0.12)",
                              color: isPreImpl ? "#2e7d32" : "rgba(103,80,164,0.9)",
                              marginRight: 6,
                            }}>
                              기능 {fnCount}개
                            </span>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", display: "inline-block", maxWidth: "calc(100% - 80px)", verticalAlign: "middle", whiteSpace: "nowrap" }}>
                              {fnNames}
                            </span>
                          </div>
                        )}

                        {/* PRE_IMPL: 기능 목록이 없으면 안내 문구 */}
                        {isPreImpl && fnCount === 0 && (
                          <div style={{
                            fontSize: 11, color: "#2e7d32",
                            padding: "6px 8px", background: "rgba(46,125,50,0.05)", borderRadius: 4,
                          }}>
                            기준선 갱신 — 선택 계층의 스냅샷이 현재 상태로 갱신됨
                          </div>
                        )}

                        {/* 코멘트 (있으면) */}
                        {row.comment?.trim() && (
                          <div style={{
                            fontSize: 11, color: "var(--color-text-secondary)",
                            padding: "4px 0 0", display: "flex", gap: 6, alignItems: "flex-start",
                          }}>
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 3,
                              background: "#fff3e0", color: "#e65100", flexShrink: 0,
                            }}>
                              코멘트
                            </span>
                            <span style={{
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              flex: 1, minWidth: 0,
                            }}>
                              {row.comment.trim()}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 상세 팝업 — 이력 팝업 위에 레이어 */}
      {detailTaskId && (
        <AiTaskDetailDialog
          projectId={projectId}
          taskId={detailTaskId}
          onClose={() => setDetailTaskId(null)}
        />
      )}
    </>
  );
}
