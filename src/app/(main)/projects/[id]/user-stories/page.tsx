"use client";

/**
 * UserStoriesPage — 사용자스토리 목록 (PID-00033)
 *
 * 역할:
 *   - 과업·요구사항 필터 + 키워드 검색 (FID-00110)
 *   - 카드 그리드 목록 조회 (FID-00111)
 *   - 삭제 확인 모달 + 삭제 실행 (FID-00112)
 */

import { Suspense, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type StoryCard = {
  storyId:                 string;
  displayId:               string;
  name:                    string;
  persona:                 string;
  requirementId:           string;
  requirementName:         string;
  taskId:                  string | null;
  taskName:                string;
  acceptanceCriteriaCount: number;
};

type TaskOption       = { taskId: string; name: string };
type RequirementOption = { requirementId: string; name: string; taskId: string | null };

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function UserStoriesPage() {
  return (
    <Suspense fallback={null}>
      <UserStoriesPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function UserStoriesPageInner() {
  const params       = useParams<{ id: string }>();
  const router       = useRouter();
  const searchParams = useSearchParams();
  const queryClient  = useQueryClient();
  const projectId    = params.id;

  // ── URL 쿼리 필터 초기값 ─────────────────────────────────────────────────────
  // 요구사항 상세의 "사용자스토리 목록" 링크가 ?reqId=xxx 로 진입 시 해당 요구사항 필터 자동 적용.
  // 과업 상세에서도 향후 ?taskId=xxx 로 진입 가능하도록 둘 다 지원한다.
  const initialReqFilter  = searchParams.get("reqId")  ?? "";
  const initialTaskFilter = searchParams.get("taskId") ?? "";

  const [taskFilter, setTaskFilter]   = useState(initialTaskFilter);
  const [reqFilter,  setReqFilter]    = useState(initialReqFilter);
  const [keyword,    setKeyword]      = useState("");
  const [deleteTarget, setDeleteTarget] = useState<StoryCard | null>(null);

  // ── 과업 목록 (필터 옵션) ──────────────────────────────────────────────────
  const { data: tasksData } = useQuery({
    queryKey: ["tasks-for-filter", projectId],
    queryFn:  () =>
      authFetch<{ data: { tasks: TaskOption[] } }>(
        `/api/projects/${projectId}/tasks`
      ).then((r) => r.data.tasks),
  });
  const taskOptions = tasksData ?? [];

  // ── 요구사항 목록 (과업 필터 연동) ────────────────────────────────────────
  const { data: reqsData } = useQuery({
    queryKey: ["reqs-for-filter", projectId],
    queryFn:  () =>
      authFetch<{ data: { items: RequirementOption[] } }>(
        `/api/projects/${projectId}/requirements`
      ).then((r) =>
        r.data.items.map((i) => ({
          requirementId: i.requirementId,
          name:          i.name,
          taskId:        i.taskId,
        }))
      ),
  });
  const allReqOptions = reqsData ?? [];
  // 과업 필터 선택 시 해당 과업 요구사항만 표시
  const reqOptions = taskFilter
    ? allReqOptions.filter((r) => r.taskId === taskFilter)
    : allReqOptions;

  // 과업 필터 변경 시 요구사항 필터 초기화
  function handleTaskFilterChange(val: string) {
    setTaskFilter(val);
    setReqFilter("");
  }

  // ── 스토리 목록 조회 ───────────────────────────────────────────────────────
  const qParams = new URLSearchParams();
  if (taskFilter) qParams.set("taskId", taskFilter);
  if (reqFilter)  qParams.set("requirementId", reqFilter);
  if (keyword)    qParams.set("keyword", keyword);

  const { data, isLoading } = useQuery({
    queryKey: ["user-stories", projectId, taskFilter, reqFilter, keyword],
    queryFn:  () =>
      authFetch<{ data: { items: StoryCard[]; totalCount: number } }>(
        `/api/projects/${projectId}/user-stories?${qParams.toString()}`
      ).then((r) => r.data),
  });

  const stories = data?.items ?? [];

  // ── 삭제 뮤테이션 ──────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (storyId: string) =>
      authFetch(`/api/projects/${projectId}/user-stories/${storyId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success("사용자스토리가 삭제되었습니다.");
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["user-stories", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) {
    return <div style={{ padding: "40px 32px", color: "#888" }}>로딩 중...</div>;
  }

  return (
    <div style={{ padding: 0 }}>
      {/* ── 헤더 타이틀 ──────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)", marginBottom: 16 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
          사용자스토리 목록
        </div>
        <button
          onClick={() => router.push(`/projects/${projectId}/user-stories/new`)}
          style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 14px" }}
        >
          + 스토리 추가
        </button>
      </div>

      <div style={{ padding: "0 24px 24px" }}>
      {/* 총 건수 (왼쪽) + 검색 필터 (오른쪽) — 기능 정의 목록과 동일 패턴 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
          총 {data?.totalCount ?? 0}건
        </span>
        <div style={{ flex: 1 }} />
        <input
          type="text"
          placeholder="스토리명·페르소나 검색..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ ...filterSelectStyle, minWidth: 220, backgroundImage: "none", paddingRight: 12 }}
        />
        <select
          value={taskFilter}
          onChange={(e) => handleTaskFilterChange(e.target.value)}
          style={filterSelectStyle}
        >
          <option value="">과업 전체</option>
          {taskOptions.map((t) => (
            <option key={t.taskId} value={t.taskId}>{t.name}</option>
          ))}
        </select>
        <select
          value={reqFilter}
          onChange={(e) => setReqFilter(e.target.value)}
          style={filterSelectStyle}
        >
          <option value="">요구사항 전체</option>
          {reqOptions.map((r) => (
            <option key={r.requirementId} value={r.requirementId}>{r.name}</option>
          ))}
        </select>
        {(taskFilter || reqFilter || keyword) && (
          <button
            onClick={() => { setTaskFilter(""); setReqFilter(""); setKeyword(""); }}
            style={{ fontSize: 12, padding: "5px 10px", borderRadius: 5, border: "1px solid var(--color-border)", background: "none", cursor: "pointer", color: "var(--color-text-secondary)" }}
          >
            초기화
          </button>
        )}
      </div>

      {/* ── 테이블 목록 ──────────────────────────────────────────────────────── */}
      {stories.length === 0 ? (
        <div style={{ padding: "60px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
          등록된 사용자스토리가 없습니다.
        </div>
      ) : (
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
          {/* 헤더 */}
          <div style={gridHeaderStyle}>
            <div>과업 › 요구사항</div>
            <div>스토리명</div>
            <div>페르소나</div>
            <div style={{ textAlign: "center" }}>인수기준</div>
            <div />
          </div>

          {/* 행 */}
          {stories.map((s, idx) => (
            <div
              key={s.storyId}
              onClick={() => router.push(`/projects/${projectId}/user-stories/${s.storyId}`)}
              style={{
                ...gridRowStyle,
                borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
              }}
            >
              {/* 과업 › 요구사항 */}
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.4 }}>
                {s.taskName && <span>{s.taskName}</span>}
                {s.taskName && s.requirementName && <span style={{ margin: "0 4px", color: "#ccc" }}>›</span>}
                {s.requirementName && <span>{s.requirementName}</span>}
              </div>

              {/* 스토리명 */}
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                <span style={{ color: "var(--color-text-secondary)", fontSize: 11, marginRight: 6 }}>
                  {s.displayId}
                </span>
                {s.name}
              </div>

              {/* 페르소나 */}
              <div style={{ fontSize: 13, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {s.persona || <span style={{ color: "#ccc" }}>—</span>}
              </div>

              {/* 인수기준 수 */}
              <div style={{ textAlign: "center" }}>
                <span style={{
                  display: "inline-block", padding: "2px 8px", borderRadius: 4,
                  fontSize: 12, background: "var(--color-bg-muted)", color: "var(--color-text-secondary)",
                }}>
                  {s.acceptanceCriteriaCount}개
                </span>
              </div>

              {/* 삭제 버튼 */}
              <div style={{ display: "flex", justifyContent: "center" }} onClick={(e) => e.stopPropagation()}>
                <button onClick={() => setDeleteTarget(s)} style={dangerBtnStyle}>삭제</button>
              </div>
            </div>
          ))}
        </div>
      )}

      </div>

      {/* 삭제 확인 모달 */}
      {deleteTarget && (
        <DeleteConfirmModal
          story={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deleteMutation.mutate(deleteTarget.storyId)}
          isPending={deleteMutation.isPending}
        />
      )}
    </div>
  );
}

// ── 삭제 확인 모달 ────────────────────────────────────────────────────────────

function DeleteConfirmModal({
  story, onCancel, onConfirm, isPending,
}: {
  story:     StoryCard;
  onCancel:  () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>
          사용자스토리를 삭제하시겠습니까?
        </h3>
        <p style={{ margin: "0 0 8px", fontSize: 14, color: "var(--color-text-primary)", fontWeight: 600 }}>
          &lsquo;{story.name}&rsquo;
        </p>
        <p style={{ margin: "0 0 24px", fontSize: 13, color: "#888" }}>
          사용자스토리를 삭제하면 인수기준도 함께 삭제됩니다.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} style={secondaryBtnStyle} disabled={isPending}>
            취소
          </button>
          <button
            onClick={onConfirm}
            style={{ ...primaryBtnStyle, background: "#e53935" }}
            disabled={isPending}
          >
            {isPending ? "삭제 중..." : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 스타일 ───────────────────────────────────────────────────────────────────

const gridHeaderStyle: React.CSSProperties = {
  display:               "grid",
  gridTemplateColumns:   "2fr 3fr 3fr 80px 60px",
  padding:               "8px 14px",
  background:            "var(--color-bg-muted)",
  fontSize:              12,
  fontWeight:            600,
  color:                 "var(--color-text-secondary)",
  gap:                   8,
};

const gridRowStyle: React.CSSProperties = {
  display:               "grid",
  gridTemplateColumns:   "2fr 3fr 3fr 80px 60px",
  padding:               "10px 14px",
  alignItems:            "center",
  cursor:                "pointer",
  gap:                   8,
  background:            "var(--color-bg-card)",
};

const filterSelectStyle: React.CSSProperties = {
  padding:            "7px 12px",
  paddingRight:       "32px",
  borderRadius:       6,
  border:             "1px solid var(--color-border)",
  background:         "var(--color-bg-card)",
  color:              "var(--color-text-primary)",
  fontSize:           13,
  outline:            "none",
  appearance:         "none",
  WebkitAppearance:   "none",
  backgroundImage:    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
  backgroundRepeat:   "no-repeat",
  backgroundPosition: "right 10px center",
};

const primaryBtnStyle: React.CSSProperties = {
  padding:      "8px 20px",
  borderRadius: 6,
  border:       "1px solid transparent",
  background:   "var(--color-primary, #1976d2)",
  color:        "#fff",
  fontSize:     14,
  fontWeight:   600,
  cursor:       "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding:      "8px 16px",
  borderRadius: 6,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     14,
  cursor:       "pointer",
};

const dangerBtnStyle: React.CSSProperties = {
  padding:      "4px 10px",
  borderRadius: 4,
  border:       "1px solid #e53935",
  background:   "transparent",
  color:        "#e53935",
  fontSize:     12,
  cursor:       "pointer",
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
