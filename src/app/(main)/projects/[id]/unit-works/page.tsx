"use client";

/**
 * UnitWorksPage — 단위업무 목록 (PID-00040)
 *
 * 역할:
 *   - 단위업무 목록 조회 (FID-00129) — 요구사항별 그룹 + 요구사항 필터
 *   - 드래그앤드롭 순서 조정 (FID-00132)
 *   - 진행률 인라인 수정 (FID-00133)
 *   - 단위업무 삭제 확인 팝업 (PID-00042 / FID-00131)
 *
 * 주요 기술:
 *   - TanStack Query: 목록 조회 및 낙관적 업데이트
 *   - useRef 기반 HTML5 네이티브 드래그앤드롭 (dnd-kit 미사용)
 *   - PATCH progress: 인라인 진행률 수정
 */

import { Suspense, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type UnitWorkRow = {
  unitWorkId:    string;
  displayId:     string;
  name:          string;
  description:   string;
  assignMemberId: string | null;
  startDate:     string | null;
  endDate:       string | null;
  progress:      number;
  sortOrder:     number;
  reqId:         string;
  reqDisplayId:  string;
  reqName:       string;
  screenCount:   number;
};

type RequirementOption = {
  requirementId: string;
  displayId:     string;
  name:          string;
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function UnitWorksPage() {
  return (
    <Suspense fallback={null}>
      <UnitWorksPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function UnitWorksPageInner() {
  const params      = useParams<{ id: string }>();
  const router      = useRouter();
  const queryClient = useQueryClient();
  const projectId   = params.id;

  // 요구사항 필터 (빈 문자열 = 전체)
  const [filterReqId, setFilterReqId] = useState("");

  // 삭제 다이얼로그 상태
  const [deleteTarget, setDeleteTarget] = useState<UnitWorkRow | null>(null);

  // ── 드래그 상태 ────────────────────────────────────────────────────────────
  const dragItem     = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  // ── 단위업무 목록 조회 ──────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ["unit-works", projectId, filterReqId],
    queryFn:  () => {
      const qs = filterReqId ? `?reqId=${filterReqId}` : "";
      return authFetch<{ data: { items: UnitWorkRow[]; totalCount: number } }>(
        `/api/projects/${projectId}/unit-works${qs}`
      ).then((r) => r.data);
    },
  });

  const items = data?.items ?? [];

  // ── 요구사항 목록 조회 (필터 드롭다운용) ────────────────────────────────────
  const { data: reqData } = useQuery({
    queryKey: ["requirements-for-filter", projectId],
    queryFn:  () =>
      authFetch<{ data: { items: RequirementOption[] } }>(
        `/api/projects/${projectId}/requirements`
      ).then((r) => r.data.items),
  });
  const reqOptions = reqData ?? [];

  // ── 순서 변경 뮤테이션 ──────────────────────────────────────────────────────
  const sortMutation = useMutation({
    mutationFn: (orders: { unitWorkId: string; sortOrder: number }[]) =>
      authFetch(`/api/projects/${projectId}/unit-works/sort`, {
        method: "PUT",
        body:   JSON.stringify({ orders }),
      }),
    onError: () => {
      toast.error("순서 변경에 실패했습니다.");
      queryClient.invalidateQueries({ queryKey: ["unit-works", projectId] });
    },
  });

  // ── 진행률 인라인 수정 뮤테이션 ─────────────────────────────────────────────
  const progressMutation = useMutation({
    mutationFn: ({ unitWorkId, progress }: { unitWorkId: string; progress: number }) =>
      authFetch(`/api/projects/${projectId}/unit-works/${unitWorkId}/progress`, {
        method: "PATCH",
        body:   JSON.stringify({ progress }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unit-works", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 드래그 핸들러 ──────────────────────────────────────────────────────────
  function handleDragStart(index: number) {
    dragItem.current = index;
  }

  function handleDragEnter(index: number) {
    dragOverItem.current = index;
  }

  function handleDragEnd() {
    const from = dragItem.current;
    const to   = dragOverItem.current;
    if (from === null || to === null || from === to) return;

    const reordered = [...items];
    const [moved]   = reordered.splice(from, 1);
    if (!moved) return;
    reordered.splice(to, 0, moved);

    // 낙관적 업데이트 후 서버 동기화
    queryClient.setQueryData(
      ["unit-works", projectId, filterReqId],
      { items: reordered, totalCount: reordered.length }
    );

    const orders = reordered.map((uw, idx) => ({
      unitWorkId: uw.unitWorkId,
      sortOrder:  idx + 1,
    }));
    sortMutation.mutate(orders);

    dragItem.current     = null;
    dragOverItem.current = null;
  }

  // ── 진행률 변경 ────────────────────────────────────────────────────────────
  function handleProgressChange(unitWorkId: string, value: string) {
    const num = parseInt(value);
    if (isNaN(num) || num < 0 || num > 100) return;
    progressMutation.mutate({ unitWorkId, progress: num });
  }

  // ── 로딩 ───────────────────────────────────────────────────────────────────
  if (isLoading) {
    return <div style={{ padding: "40px 32px", color: "#888" }}>로딩 중...</div>;
  }

  return (
    <div style={{ padding: 0 }}>
      {/* ── 헤더 타이틀 ──────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
            단위업무 목록
          </div>
        </div>
        <button
          onClick={() => router.push(`/projects/${projectId}/unit-works/new`)}
          style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 14px" }}
        >
          + 신규 등록
        </button>
      </div>

      <div style={{ padding: "0 24px 24px" }}>
      {/* ── 검색 필터 ────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        {/* 요구사항 필터 */}
        <select
          value={filterReqId}
          onChange={(e) => setFilterReqId(e.target.value)}
          style={{ ...inputStyle, width: "auto", minWidth: 200 }}
        >
          <option value="">전체 요구사항</option>
          {reqOptions.map((r) => (
            <option key={r.requirementId} value={r.requirementId}>
              {r.displayId} — {r.name}
            </option>
          ))}
        </select>
        
        <div style={{ flex: 1 }} />
      </div>

      {/* 총 건수 */}
      <div style={{ marginBottom: 16, fontSize: 14, color: "var(--color-text-secondary)" }}>
        총 {items.length}건
      </div>

      {/* 목록 */}
      {items.length === 0 ? (
        <div style={{ padding: "60px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
          등록된 단위업무가 없습니다.
        </div>
      ) : (
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
          {/* 헤더 행 */}
          <div style={gridHeaderStyle}>
            <div />
            <div>요구사항</div>
            <div>단위업무명</div>
            <div>기간</div>
            <div style={{ textAlign: "center" }}>진행률</div>
            <div style={{ textAlign: "center" }}>화면수</div>
            <div />
          </div>

          {/* 데이터 행 */}
          {items.map((uw, idx) => (
            <div
              key={uw.unitWorkId}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragEnter={() => handleDragEnter(idx)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => e.preventDefault()}
              style={{
                ...gridRowStyle,
                borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
              }}
            >
              {/* 드래그 핸들 */}
              <div style={{ cursor: "grab", color: "#aaa", userSelect: "none", paddingLeft: 4 }}>
                ☰
              </div>

              {/* 요구사항 */}
              <div>
                <button
                  onClick={() => router.push(`/projects/${projectId}/requirements/${uw.reqId}`)}
                  style={linkBtnStyle}
                >
                  <span style={{ color: "var(--color-text-secondary)", fontSize: 12, marginRight: 4 }}>
                    {uw.reqDisplayId}
                  </span>
                  {uw.reqName}
                </button>
              </div>

              {/* 단위업무명 (클릭 → 상세) */}
              <div>
                <button
                  onClick={() => router.push(`/projects/${projectId}/unit-works/${uw.unitWorkId}`)}
                  style={linkBtnStyle}
                >
                  <span style={{ color: "var(--color-text-secondary)", fontSize: 12, marginRight: 6 }}>
                    {uw.displayId}
                  </span>
                  {uw.name}
                </button>
              </div>

              {/* 기간 */}
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                {uw.startDate && uw.endDate
                  ? `${uw.startDate} ~ ${uw.endDate}`
                  : uw.startDate
                  ? `${uw.startDate} ~`
                  : "미정"}
              </div>

              {/* 진행률 인라인 수정 (FID-00133) */}
              <div style={{ textAlign: "center" }}>
                <ProgressCell
                  unitWorkId={uw.unitWorkId}
                  progress={uw.progress}
                  isPending={progressMutation.isPending}
                  onChange={handleProgressChange}
                />
              </div>

              {/* 화면수 */}
              <div style={{ textAlign: "center", fontSize: 13, color: "var(--color-text-secondary)" }}>
                {uw.screenCount}
              </div>

              {/* 삭제 버튼 */}
              <div>
                <button
                  onClick={() => setDeleteTarget(uw)}
                  style={dangerBtnStyle}
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      </div>

      {/* PID-00042 삭제 확인 팝업 */}
      {deleteTarget && (
        <DeleteConfirmDialog
          unitWork={deleteTarget}
          projectId={projectId}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            queryClient.invalidateQueries({ queryKey: ["unit-works", projectId] });
          }}
        />
      )}
    </div>
  );
}

// ── 진행률 셀 — 클릭하면 인라인 입력으로 전환 ────────────────────────────────

function ProgressCell({
  unitWorkId, progress, isPending, onChange,
}: {
  unitWorkId: string;
  progress:   number;
  isPending:  boolean;
  onChange:   (id: string, value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(String(progress));

  function commit() {
    onChange(unitWorkId, draft);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        type="number"
        min={0}
        max={100}
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        style={{
          width:        52,
          padding:      "2px 6px",
          border:       "1px solid var(--color-border)",
          borderRadius: 4,
          fontSize:     13,
          textAlign:    "center",
          background:   "var(--color-bg-card)",
          color:        "var(--color-text-primary)",
        }}
      />
    );
  }

  return (
    <button
      onClick={() => { setDraft(String(progress)); setEditing(true); }}
      disabled={isPending}
      title="클릭하여 수정"
      style={{
        background:   "none",
        border:       "none",
        cursor:       "pointer",
        padding:      "2px 6px",
        borderRadius: 4,
        fontSize:     13,
        color:        progress === 100 ? "#2e7d32" : "var(--color-text-primary)",
        fontWeight:   progress === 100 ? 700 : 400,
      }}
    >
      {progress}%
    </button>
  );
}

// ── PID-00042 삭제 확인 다이얼로그 ───────────────────────────────────────────

function DeleteConfirmDialog({
  unitWork, projectId, onClose, onDeleted,
}: {
  unitWork:  UnitWorkRow;
  projectId: string;
  onClose:   () => void;
  onDeleted: () => void;
}) {
  // 화면이 있을 때만 선택지를 보여줌
  // 화면이 0개면 deleteChildren 관계없이 단위업무만 삭제
  const hasScreens       = unitWork.screenCount > 0;
  const [deleteChildren, setDeleteChildren] = useState<boolean | null>(hasScreens ? null : true);

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (hasScreens && deleteChildren === null) {
        throw new Error("하위 데이터 처리 방법을 선택해 주세요.");
      }
      return authFetch(
        `/api/projects/${projectId}/unit-works/${unitWork.unitWorkId}?deleteChildren=${deleteChildren ?? true}`,
        { method: "DELETE" }
      );
    },
    onSuccess: () => {
      toast.success("단위업무가 삭제되었습니다.");
      onDeleted();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleDelete() {
    if (hasScreens && deleteChildren === null) {
      toast.error("하위 데이터 처리 방법을 선택해 주세요.");
      return;
    }
    deleteMutation.mutate();
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>
          단위업무를 삭제하시겠습니까?
        </h3>
        <p style={{ margin: "0 0 20px", fontSize: 14, color: "var(--color-text-secondary)" }}>
          &lsquo;{unitWork.name}&rsquo;
        </p>

        {/* 화면이 있을 때만 하위 처리 선택지 표시 */}
        {hasScreens && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
            <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--color-text-secondary)" }}>
              연결된 화면 {unitWork.screenCount}개 처리 방법:
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
              <input
                type="radio"
                name="deleteType"
                checked={deleteChildren === true}
                onChange={() => setDeleteChildren(true)}
              />
              하위 화면 전체 삭제
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
              <input
                type="radio"
                name="deleteType"
                checked={deleteChildren === false}
                onChange={() => setDeleteChildren(false)}
              />
              단위업무만 삭제 (화면 미분류 처리)
            </label>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={secondaryBtnStyle} disabled={deleteMutation.isPending}>
            취소
          </button>
          <button
            onClick={handleDelete}
            style={{ ...primaryBtnStyle, background: "#e53935" }}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? "삭제 중..." : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

const GRID_TEMPLATE = "32px minmax(140px, 220px) 1fr 130px 90px 70px 60px";

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

const inputStyle: React.CSSProperties = {
  width:        "100%",
  padding:      "8px 12px",
  borderRadius: 6,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     14,
  boxSizing:    "border-box",
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
  padding:      "4px 12px",
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
  minWidth:     380,
  maxWidth:     480,
  boxShadow:    "0 8px 32px rgba(0,0,0,0.18)",
};
