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

import { Suspense, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import AiTaskDetailDialog from "@/components/ui/AiTaskDetailDialog";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type TaskStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "APPLIED" | "REJECTED" | "FAILED" | "TIMEOUT";
type TaskType   = "INSPECT" | "DESIGN" | "IMPLEMENT" | "MOCKUP" | "IMPACT" | "CUSTOM" | "IA" | "JOURNEY" | "FLOW" | "ERD" | "PROCESS";
type RefType    = "AREA" | "FUNCTION" | "UNIT_WORK" | "PLAN_STUDIO_ARTF";

type TaskRow = {
  taskId:       string;
  taskType:     TaskType;
  refType:      RefType;
  refId:        string;
  refName:      string;
  refDisplayId: string;
  unitWorkName: string | null;
  screenName:   string | null;
  areaName:     string | null;
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
  MOCKUP:    "목업",
  IMPACT:    "영향도 분석",
  CUSTOM:    "자유 요청",
  IA:        "정보구조도",
  JOURNEY:   "사용자여정",
  FLOW:      "화면흐름",
  ERD:       "ERD",
  PROCESS:   "업무프로세스",
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
    IMPLEMENT: { bg: "#fce4ec", color: "#c62828" },
    MOCKUP:    { bg: "#f1f8e9", color: "#558b2f" },
    IMPACT:    { bg: "#fff3e0", color: "#ef6c00" },
    CUSTOM:    { bg: "#f5f5f5", color: "#757575" },
    IA:        { bg: "#e3f2fd", color: "#1565c0" },
    JOURNEY:   { bg: "#e8f5e9", color: "#2e7d32" },
    FLOW:      { bg: "#fff3e0", color: "#e65100" },
    ERD:       { bg: "#ede7f6", color: "#4527a0" },
    PROCESS:   { bg: "#e0f2f1", color: "#00695c" },
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
  const colors: Record<RefType, { bg: string; color: string }> = {
    AREA:             { bg: "#f5f5f5", color: "#666666" },
    FUNCTION:         { bg: "#f3e5f5", color: "#7b1fa2" },
    UNIT_WORK:        { bg: "#e3f2fd", color: "#1565c0" },
    PLAN_STUDIO_ARTF: { bg: "#fce4ec", color: "#c62828" },
  };
  const c = colors[type] ?? { bg: "#f5f5f5", color: "#555" };
  return {
    display:      "inline-block",
    padding:      "2px 6px",
    borderRadius: 4,
    fontSize:     11,
    fontWeight:   700,
    backgroundColor: c.bg,
    color:           c.color,
    border:          "1px solid var(--color-border)",
  };
}

// ── 유틸 ──────────────────────────────────────────────────────────────────────

function formatDatetime(iso: string): string {
  const d = new Date(iso);
  // 연도 생략 — MM-DD HH:mm 형식으로 컬럼 너비 절약
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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

// ── 창 크기 기반 pageSize 계산 훅 ────────────────────────────────────────────

// 레이아웃 고정 영역: 상단바 52 + 페이지헤더 52 + 필터 60 + 총건수/페이징 40 + 테이블헤더 38 + 여백 48 = 290px
// 행 높이: 메인텍스트(20) + breadcrumb(16) + 패딩(8) + border(1) ≈ 45px
const LAYOUT_OVERHEAD = 290;
const ROW_HEIGHT      = 45;

function usePageSize(): number {
  // lazy initializer — 첫 렌더 시 한 번만 실행, 이후 절대 변하지 않음
  const [pageSize] = useState(() =>
    typeof window === "undefined"
      ? 15
      : Math.max(5, Math.floor((window.innerHeight - LAYOUT_OVERHEAD) / ROW_HEIGHT) - 1)
  );
  return pageSize;
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

  // ── 필터 / 페이지 상태 ────────────────────────────────────────────────────
  const [filterStatus,   setFilterStatus]   = useState<string>("");
  const [filterTaskType, setFilterTaskType] = useState<string>("");
  const [filterRefType,  setFilterRefType]  = useState<string>("");
  const [filterMember,   setFilterMember]   = useState<string>("");
  const [page,           setPage]           = useState(1);
  const PAGE_SIZE = usePageSize();

  // ── 멤버 목록 (필터 셀렉트용) ─────────────────────────────────────────────
  const { data: membersData } = useQuery({
    queryKey: ["members", projectId],
    queryFn:  () =>
      authFetch<{ data: { members: { memberId: string; name: string | null; email: string }[] } }>(
        `/api/projects/${projectId}/members`
      ).then((r) => r.data.members),
    staleTime: 60_000,
  });

  // ── 선택된 row 상태 (상세 패널) ───────────────────────────────────────────
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // ── 강제 취소 확인 상태 ────────────────────────────────────────────────────
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);

  // ── 데이터 조회 ────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ["ai-tasks", projectId, filterStatus, filterTaskType, filterRefType, filterMember, page],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (filterStatus)   sp.set("status",     filterStatus);
      if (filterTaskType) sp.set("taskType",   filterTaskType);
      if (filterRefType)  sp.set("refType",    filterRefType);
      if (filterMember)   sp.set("reqMberId",  filterMember);
      sp.set("page",     String(page));
      sp.set("pageSize", String(PAGE_SIZE));
      return authFetch<{ data: { items: TaskRow[]; totalCount: number; page: number; pageSize: number; pageCount: number } }>(
        `/api/projects/${projectId}/ai-tasks?${sp.toString()}`
      ).then((r) => r.data);
    },
    refetchInterval: (query) => {
      const items = (query.state.data as { items: TaskRow[] } | undefined)?.items ?? [];
      return items.some((t) => t.status === "IN_PROGRESS") ? 10_000 : false;
    },
  });

  const items      = data?.items      ?? [];
  const totalCount = data?.totalCount ?? 0;
  const pageCount  = data?.pageCount  ?? 1;

  // 필터 변경 시 1페이지로 리셋
  function handleFilterChange(setter: (v: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  // ── 삭제 뮤테이션 ─────────────────────────────────────────────────────────
  const deleteMutation = useMutation<unknown, Error, string>({
    mutationFn: (taskId) =>
      authFetch(`/api/projects/${projectId}/ai-tasks/${taskId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["ai-tasks", projectId] });
    },
    onError: (err) => toast.error(err.message),
  });

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
    } else if (row.refType === "UNIT_WORK") {
      router.push(`/projects/${projectId}/unit-works/${row.refId}`);
    } else {
      router.push(`/projects/${projectId}/functions/${row.refId}`);
    }
  }

  // ── 11컬럼 그리드 템플릿 ──────────────────────────────────────────
  // 요청구분 | 작업유형 | 대상(가변) | 요청자 | 요청일시 | 완료일시 | 소요 | 재시도 | 상태/액션 | 실행가능일 | 삭제
  const GRID_CONFIG = "64px 90px minmax(200px, 1fr) 64px 86px 86px 52px 40px 100px 68px 36px";

  return (
    <div style={{ padding: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", minHeight: 52, background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)", marginBottom: 16 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
          AI 태스크 목록
        </div>
      </div>

      <div style={{ padding: "0 24px 24px" }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
          <select value={filterStatus} onChange={(e) => handleFilterChange(setFilterStatus, e.target.value)} style={{ ...filterSelectStyle, width: 140 }}>
            <option value="">상태 전체</option>
            <option value="PENDING">대기</option>
            <option value="IN_PROGRESS">처리중</option>
            <option value="DONE">완료</option>
            <option value="APPLIED">반영됨</option>
            <option value="REJECTED">반려</option>
            <option value="FAILED">실패</option>
            <option value="TIMEOUT">시간초과</option>
          </select>

          <select value={filterTaskType} onChange={(e) => handleFilterChange(setFilterTaskType, e.target.value)} style={{ ...filterSelectStyle, width: 140 }}>
            <option value="">유형 전체</option>
            <option value="INSPECT">명세 검토</option>
            <option value="DESIGN">설계</option>
            <option value="IMPLEMENT">구현</option>
            <option value="MOCKUP">목업</option>
            <option value="IMPACT">영향도 분석</option>
            <option value="CUSTOM">자유 요청</option>
          </select>

          <select value={filterRefType} onChange={(e) => handleFilterChange(setFilterRefType, e.target.value)} style={{ ...filterSelectStyle, width: 140 }}>
            <option value="">대상 전체</option>
            <option value="UNIT_WORK">단위업무</option>
            <option value="AREA">영역</option>
            <option value="FUNCTION">기능</option>
            <option value="PLAN_STUDIO_ARTF">기획실</option>
          </select>

          <select value={filterMember} onChange={(e) => handleFilterChange(setFilterMember, e.target.value)} style={{ ...filterSelectStyle, width: 140 }}>
            <option value="">요청자 전체</option>
            {(membersData ?? []).map((m) => (
              <option key={m.memberId} value={m.memberId}>{m.name ?? m.email}</option>
            ))}
          </select>
          <div style={{ flex: 1 }} />
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
            총 {totalCount}건
          </div>
          {pageCount > 1 && (
            <Pagination page={page} pageCount={pageCount} onChange={setPage} />
          )}
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
                <div />
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
                      {row.refType === "AREA" ? "영역" : row.refType === "UNIT_WORK" ? "단위업무" : row.refType === "PLAN_STUDIO_ARTF" ? "기획실" : "기능"}
                    </span>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <span style={taskTypeBadgeStyle(row.taskType)}>
                      {TASK_TYPE_LABELS[row.taskType]}
                    </span>
                  </div>
                  <div style={{ overflow: "hidden", minWidth: 0 }}>
                    <button
                      style={{ ...linkBtnStyle, fontWeight: 500, display: "inline-flex", alignItems: "center", maxWidth: "100%", overflow: "hidden" }}
                      onClick={(e) => { e.stopPropagation(); navigateToRef(row); }}
                      type="button"
                    >
                      {row.refDisplayId && <span style={{ color: "var(--color-primary)", fontSize: 13, marginRight: 6, fontWeight: 600, flexShrink: 0 }}>{row.refDisplayId}</span>}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.refName}</span>
                    </button>
                    {/* IMPLEMENT: 포함된 기능 목록 표시 */}
                    {(row.implFunctions?.length ?? 0) > 0 ? (
                      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {row.implFunctions!.map((f) => f.name).join(", ")}
                      </div>
                    ) : (
                      <RefBreadcrumb row={row} />
                    )}
                  </div>
                  <div style={{ textAlign: "center", fontSize: 13, color: "var(--color-text-primary)" }}>{row.reqMberName}</div>
                  <div style={{ textAlign: "center", fontSize: 12, color: "var(--color-text-secondary)" }}>{formatDatetime(row.requestedAt)}</div>
                  <div style={{ textAlign: "center", fontSize: 12, color: "var(--color-text-secondary)" }}>{row.completedAt ? formatDatetime(row.completedAt) : "—"}</div>
                  <div style={{ textAlign: "center", fontSize: 12, fontWeight: 600, color: "var(--color-text-primary)" }}>
                    {row.completedAt ? formatDuration(row.requestedAt, row.completedAt) : (row.status === "IN_PROGRESS" ? formatElapsed(row.elapsedMs) : "—")}
                  </div>
                  <div style={{ textAlign: "center", fontSize: 13, fontWeight: 600, color: row.retryCnt > 0 ? "#e65100" : "var(--color-text-secondary)" }}>
                    {row.retryCnt > 0 ? `${row.retryCnt}회` : "—"}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    <span style={statusBadgeStyle(row.status)}>{STATUS_LABELS[row.status]}</span>
                    {["FAILED", "REJECTED", "TIMEOUT"].includes(row.status) && (
                      <button
                        title="재요청 — 새 태스크 생성"
                        style={{ ...actionBtnStyle, padding: "2px 5px", fontSize: 14 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(
                            "동일한 내용으로 새 AI 태스크를 생성합니다.\n" +
                            "기존 태스크는 그대로 남아 있으며, 목록에 행이 하나 추가됩니다.\n\n" +
                            "재요청하시겠습니까?"
                          )) {
                            retryMutation.mutate(row.taskId);
                          }
                        }}
                        disabled={retryMutation.isPending}
                        type="button"
                      >
                        ↺
                      </button>
                    )}
                  </div>
                  <div style={{ textAlign: "center", fontSize: 12, color: "var(--color-text-secondary)" }}>{row.execAvlblDt ? formatDatetime(row.execAvlblDt) : "—"}</div>
                  <div style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                    <button
                      title="삭제"
                      type="button"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#bbb", fontSize: 16, lineHeight: 1, padding: "2px 4px", borderRadius: 4 }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "#e53935")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "#bbb")}
                      onClick={() => {
                        if (window.confirm("이 AI 태스크를 삭제하시겠습니까?")) {
                          deleteMutation.mutate(row.taskId);
                        }
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedTaskId && (
          <AiTaskDetailDialog projectId={projectId} taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
        )}

        {cancelConfirmId && (
          <CancelConfirmDialog onConfirm={() => cancelMutation.mutate(cancelConfirmId)} onClose={() => setCancelConfirmId(null)} isPending={cancelMutation.isPending} />
        )}
      </div>
    </div>
  );
}

// ── 페이지네이션 ──────────────────────────────────────────────────────────────

function Pagination({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (p: number) => void }) {
  // 현재 페이지 기준 최대 5개 버튼 표시
  const WINDOW = 5;
  const half   = Math.floor(WINDOW / 2);
  let start    = Math.max(1, page - half);
  const end    = Math.min(pageCount, start + WINDOW - 1);
  if (end - start + 1 < WINDOW) start = Math.max(1, end - WINDOW + 1);
  const pages  = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  const btnBase: React.CSSProperties = {
    minWidth: 30, height: 28, padding: "0 6px",
    border: "1px solid var(--color-border)", borderRadius: 5,
    background: "var(--color-bg-card)", color: "var(--color-text-primary)",
    fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
  };
  const activeBtnStyle: React.CSSProperties = {
    ...btnBase,
    background: "var(--color-primary, #1976d2)", color: "#fff",
    border: "1px solid var(--color-primary, #1976d2)", fontWeight: 700,
  };
  const disabledStyle: React.CSSProperties = { ...btnBase, opacity: 0.35, cursor: "default" };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <button style={page <= 1 ? disabledStyle : btnBase} disabled={page <= 1} onClick={() => onChange(1)} type="button">«</button>
      <button style={page <= 1 ? disabledStyle : btnBase} disabled={page <= 1} onClick={() => onChange(page - 1)} type="button">‹</button>
      {start > 1 && <span style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "0 2px" }}>…</span>}
      {pages.map((p) => (
        <button key={p} style={p === page ? activeBtnStyle : btnBase} onClick={() => onChange(p)} type="button">{p}</button>
      ))}
      {end < pageCount && <span style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "0 2px" }}>…</span>}
      <button style={page >= pageCount ? disabledStyle : btnBase} disabled={page >= pageCount} onClick={() => onChange(page + 1)} type="button">›</button>
      <button style={page >= pageCount ? disabledStyle : btnBase} disabled={page >= pageCount} onClick={() => onChange(pageCount)} type="button">»</button>
    </div>
  );
}

// ── 계층 breadcrumb (단위업무 > 화면 > 영역) ─────────────────────────────────

function RefBreadcrumb({ row }: { row: TaskRow }) {
  // UNIT_WORK: (대상이 단위업무 자체라서 breadcrumb 불필요)
  // AREA:      unitWork > screen
  // FUNCTION:  unitWork > screen > area
  const parts: string[] = [];
  if (row.refType !== "UNIT_WORK" && row.unitWorkName) parts.push(row.unitWorkName);
  if (row.refType !== "UNIT_WORK" && row.screenName)   parts.push(row.screenName);
  if (row.refType === "FUNCTION" && row.areaName) parts.push(row.areaName);

  if (parts.length === 0) return null;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 3, marginTop: 1,
      fontSize: 11, color: "var(--color-text-secondary)", flexWrap: "nowrap",
      overflow: "hidden", maxWidth: "100%",
    }}>
      {parts.map((p, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 3, minWidth: 0 }}>
          {i > 0 && <span style={{ color: "#bbb", flexShrink: 0 }}>›</span>}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</span>
        </span>
      ))}
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
  padding:             "4px 16px",
  minHeight:           48,
  alignItems:          "center",
  background:          "var(--color-bg-card)",
  transition:          "background 0.1s",
};

const filterSelectStyle: React.CSSProperties = {
  padding:            "7px 32px 7px 12px",
  borderRadius:       6,
  border:             "1px solid var(--color-border)",
  background:         "var(--color-bg-card)",
  color:              "var(--color-text-primary)",
  fontSize:           13,
  outline:            "none",
  appearance:         "none",
  WebkitAppearance:   "none",
  backgroundImage:    `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
  backgroundRepeat:   "no-repeat",
  backgroundPosition: "right 10px center",
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

const actionBtnStyle: React.CSSProperties = {
  background: "none",
  border:     "1px solid var(--color-border)",
  borderRadius: 4,
  cursor:     "pointer",
  color:      "var(--color-text-secondary)",
  lineHeight: 1,
  transition: "all 0.2s ease",
};



