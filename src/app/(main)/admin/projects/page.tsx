"use client";

/**
 * AdminProjectsPage — 전체 프로젝트 목록 (/admin/projects)
 *
 * 역할:
 *   - 플랫폼 전체 프로젝트를 검색·페이지네이션으로 탐색
 *   - 각 행의 "지원 세션" 버튼으로 읽기 전용 진입 세션 발급
 *   - 발급 후 해당 프로젝트로 이동 — 상단에 경고 배너가 따라감
 *
 * 설계:
 *   - 사유(memo) 입력이 필수 — 감사 로그 가치를 보장
 *   - 이미 활성 세션이 있으면 "이미 열린 세션 유지" 로 OK(API 가 멱등 처리)
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

type ProjectItem = {
  projectId:        string;
  name:             string;
  clientName:       string | null;
  createdAt:        string;
  modifiedAt:       string | null;
  owner:            { mberId: string; email: string | null; name: string | null } | null;
  activeMemberCount:number;
};

type ProjectsResponse = {
  data: {
    items: ProjectItem[];
    pagination: { page: number; pageSize: number; totalCount: number; totalPages: number };
  };
};

type SessionCreateResponse = {
  data: {
    sessId:      string;
    projectId:   string;
    projectName: string;
    expiresAt:   string;
    memo:        string | null;
    alreadyOpen: boolean;
  };
};

const PAGE_SIZE = 50;

export default function AdminProjectsPage() {
  const router       = useRouter();
  const queryClient  = useQueryClient();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch]           = useState("");
  const [page,   setPage]             = useState(1);

  // 지원 세션 모달 상태
  const [modalTarget, setModalTarget] = useState<ProjectItem | null>(null);
  const [memoInput,   setMemoInput]   = useState("");

  const query = useQuery<ProjectsResponse["data"]>({
    queryKey: ["admin", "projects", { search, page }],
    queryFn: () =>
      authFetch<ProjectsResponse>(
        `/api/admin/projects?search=${encodeURIComponent(search)}&page=${page}&pageSize=${PAGE_SIZE}`
      ).then((r) => r.data),
  });

  // 세션 발급
  const createSession = useMutation({
    mutationFn: (input: { projectId: string; memo: string }) =>
      authFetch<SessionCreateResponse>("/api/admin/support-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(input),
      }).then((r) => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "support-sessions", "active"] });
      queryClient.invalidateQueries({ queryKey: ["support-session", "active"] });
      toast.success(
        data.alreadyOpen
          ? "이미 열려있는 세션으로 진입합니다."
          : "지원 세션이 시작되었습니다 (30분)."
      );
      setModalTarget(null);
      setMemoInput("");
      router.push(`/projects/${data.projectId}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function applySearch() {
    setSearch(searchInput);
    setPage(1);
  }

  function openSupportModal(p: ProjectItem) {
    setModalTarget(p);
    setMemoInput("");
  }

  function submitSession() {
    if (!modalTarget) return;
    if (!memoInput.trim()) {
      toast.error("진입 사유를 입력해 주세요.");
      return;
    }
    createSession.mutate({ projectId: modalTarget.projectId, memo: memoInput.trim() });
  }

  const items      = query.data?.items ?? [];
  const totalCount = query.data?.pagination.totalCount ?? 0;
  const totalPages = query.data?.pagination.totalPages ?? 1;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* 필터 바 */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          className="sp-input"
          type="text"
          placeholder="프로젝트명 또는 고객사 검색"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") applySearch(); }}
          onBlur={applySearch}
          style={{ minWidth: 240 }}
        />
        <div style={{ marginLeft: "auto", fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
          총 {totalCount.toLocaleString()}개
        </div>
      </div>

      {/* 테이블 */}
      <div
        style={{
          background:   "var(--color-bg-card)",
          border:       "1px solid var(--color-border)",
          borderRadius: "var(--radius-card)",
          overflow:     "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
          <thead>
            <tr style={{ background: "var(--color-bg-elevated)", borderBottom: "1px solid var(--color-border)" }}>
              <Th>프로젝트명</Th>
              <Th>고객사</Th>
              <Th>소유자</Th>
              <Th>멤버</Th>
              <Th>수정일</Th>
              <Th align="right">액션</Th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading && (
              <tr><Td colSpan={6} align="center">불러오는 중…</Td></tr>
            )}
            {!query.isLoading && items.length === 0 && (
              <tr><Td colSpan={6} align="center" muted>프로젝트가 없습니다.</Td></tr>
            )}
            {items.map((p) => (
              <tr key={p.projectId} style={{ borderBottom: "1px solid var(--color-border)" }}>
                <Td>
                  <div style={{ fontWeight: 500 }}>{p.name}</div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)" }}>
                    {p.projectId}
                  </div>
                </Td>
                <Td>{p.clientName ?? "—"}</Td>
                <Td>
                  {p.owner
                    ? <>
                        {p.owner.name ?? p.owner.email ?? "(이름 없음)"}
                        {p.owner.email && (
                          <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
                            {p.owner.email}
                          </div>
                        )}
                      </>
                    : <span style={{ color: "var(--color-text-tertiary)" }}>—</span>}
                </Td>
                <Td>{p.activeMemberCount}</Td>
                <Td>
                  {p.modifiedAt
                    ? new Date(p.modifiedAt).toLocaleDateString("ko-KR")
                    : new Date(p.createdAt).toLocaleDateString("ko-KR")}
                </Td>
                <Td align="right">
                  <button
                    className="sp-btn sp-btn-ghost"
                    onClick={() => openSupportModal(p)}
                    style={{ fontSize: "var(--text-xs)" }}
                  >
                    지원 세션
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div style={{ display: "flex", gap: 6, justifyContent: "center", alignItems: "center" }}>
          <button
            className="sp-btn sp-btn-ghost"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            이전
          </button>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)", padding: "0 12px" }}>
            {page} / {totalPages}
          </span>
          <button
            className="sp-btn sp-btn-ghost"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            다음
          </button>
        </div>
      )}

      {/* 지원 세션 개설 모달 */}
      {modalTarget && (
        <SupportSessionModal
          project={modalTarget}
          memo={memoInput}
          onMemoChange={setMemoInput}
          onCancel={() => { setModalTarget(null); setMemoInput(""); }}
          onSubmit={submitSession}
          loading={createSession.isPending}
        />
      )}
    </div>
  );
}

// ─── 보조 컴포넌트 ─────────────────────────────────────────────────────────

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      style={{
        padding:    "10px 12px",
        textAlign:  align ?? "left",
        fontSize:   "var(--text-xs)",
        fontWeight: 600,
        color:      "var(--color-text-tertiary)",
        textTransform: "uppercase",
        letterSpacing:"0.04em",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children, colSpan, align, muted,
}: {
  children:  React.ReactNode;
  colSpan?:  number;
  align?:    "left" | "center" | "right";
  muted?:    boolean;
}) {
  return (
    <td
      colSpan={colSpan}
      style={{
        padding:   "10px 12px",
        textAlign: align ?? "left",
        color:     muted ? "var(--color-text-tertiary)" : "var(--color-text-primary)",
        verticalAlign: "top",
      }}
    >
      {children}
    </td>
  );
}

function SupportSessionModal({
  project,
  memo,
  onMemoChange,
  onCancel,
  onSubmit,
  loading,
}: {
  project:       ProjectItem;
  memo:          string;
  onMemoChange:  (v: string) => void;
  onCancel:      () => void;
  onSubmit:      () => void;
  loading:       boolean;
}) {
  return (
    <div
      onClick={onCancel}
      style={{
        position:   "fixed",
        inset:      0,
        background: "rgba(0,0,0,0.4)",
        display:    "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex:     1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width:        480,
          maxWidth:     "92vw",
          background:   "var(--color-bg-card)",
          border:       "1px solid var(--color-border-strong)",
          borderRadius: "var(--radius-card)",
          padding:      24,
          boxShadow:    "var(--shadow-lg)",
        }}
      >
        <h2 style={{ margin: 0, marginBottom: 8, fontSize: "var(--text-lg)", color: "var(--color-text-heading)" }}>
          지원 세션 시작
        </h2>
        <div style={{ marginBottom: 16, fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
          <strong>{project.name}</strong> 에 30분 동안 읽기 전용 접근 권한을 엽니다.
          <br/>
          데이터 변경은 불가하며, 모든 활동이 감사 로그에 기록됩니다.
        </div>

        <label style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: 4 }}>
          진입 사유 <span style={{ color: "var(--color-error)" }}>*</span>
        </label>
        <textarea
          className="sp-input"
          value={memo}
          onChange={(e) => onMemoChange(e.target.value)}
          placeholder="예) 고객 지원 티켓 #1234 - 화면 로딩 오류 조사"
          rows={3}
          autoFocus
          style={{ width: "100%", resize: "vertical" }}
        />

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button className="sp-btn sp-btn-ghost" onClick={onCancel} disabled={loading}>
            취소
          </button>
          <button className="sp-btn sp-btn-primary" onClick={onSubmit} disabled={loading}>
            {loading ? "발급 중…" : "시작 (30분)"}
          </button>
        </div>
      </div>
    </div>
  );
}
