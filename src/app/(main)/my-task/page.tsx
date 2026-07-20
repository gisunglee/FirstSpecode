"use client";

/**
 * MyTaskPage — My Task (URL: /my-task)
 *
 * 역할:
 *   - 단위업무/화면/기능(요구사항 제외)을 팀 전체 누구 것이든 조회 — "내 업무"(/my-work, 나만
 *     보는 개인 스냅샷)와 달리 담당자를 자유롭게 바꿔가며 볼 수 있다.
 *   - 목록(우선순위 정렬) / 그룹(계층 트리) 두 보기를 오가며, 담당자·시작종료일·공수를
 *     그 자리에서 바로 수정한다(제자리 편집).
 *   - 담당자 필터는 목록/그룹 둘 다 실제로 걸러낸다 — 그룹은 담당 항목을 품은 조상 가지만 남기고
 *     (조상 자체는 다른 사람 소유일 수 있음) 완전히 무관한 가지는 통째로 잘라낸다.
 *   - 페이지당 20/50/100건씩 페이징(flat=행 단위, tree=단위업무 루트 단위).
 */

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";
import type { MyTaskResponse, MyTaskView, MyTaskSortBy } from "@/types/myTask";

import MyTaskFlatList from "./_components/MyTaskFlatList";
import MyTaskTree     from "./_components/MyTaskTree";

type MembersResponse = {
  members: { memberId: string; name: string | null; email: string }[];
  myMemberId: string;
};

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

// 페이지당 건수 기억 — dashboard/useDashboardView.ts와 동일한 localStorage 안전 래퍼 패턴.
// Safari 시크릿 모드 등에서 throw 가능해서 실패해도 앱이 깨지지 않게 try/catch로 감싼다.
const LS_PAGE_SIZE_KEY = "specode-my-task-page-size";

function lsGet(key: string): string | null {
  try { return typeof window !== "undefined" ? window.localStorage.getItem(key) : null; }
  catch { return null; }
}
function lsSet(key: string, value: string): void {
  try { if (typeof window !== "undefined") window.localStorage.setItem(key, value); }
  catch { /* 저장 실패해도 동작 자체엔 영향 없음 — 다음 진입에 기본값 20으로 폴백 */ }
}
function isPageSize(v: unknown): v is PageSize {
  return v === 20 || v === 50 || v === 100;
}

export default function MyTaskPage() {
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const queryClient = useQueryClient();

  const [view, setView]     = useState<MyTaskView>("flat");
  const [sortBy, setSortBy] = useState<MyTaskSortBy>("deadline");
  const [assigneeId, setAssigneeId] = useState<string>(""); // "" = 전체
  const [defaultApplied, setDefaultApplied] = useState(false);
  const [page, setPage] = useState(1);
  // 초기값은 SSR과 동일하게 20으로 두고, 마운트 후 localStorage에 저장된 값이 있으면 덮어쓴다
  // (SSR 시점엔 window가 없어 localStorage를 읽을 수 없음 — 여기서 읽으면 hydration 불일치 발생).
  const [pageSize, setPageSizeState] = useState<PageSize>(20);

  useEffect(() => {
    const saved = Number(lsGet(LS_PAGE_SIZE_KEY));
    if (isPageSize(saved)) setPageSizeState(saved);
  }, []);

  const setPageSize = (n: PageSize) => {
    setPageSizeState(n);
    lsSet(LS_PAGE_SIZE_KEY, String(n));
  };

  // 보기/정렬/담당자가 바뀌면 결과 집합 자체가 달라지므로 1페이지로 되돌린다
  // (안 그러면 이전 필터에서 보던 페이지 번호가 새 결과 범위를 벗어날 수 있음).
  useEffect(() => {
    setPage(1);
  }, [view, sortBy, assigneeId]);

  const { data: membersData } = useQuery<MembersResponse>({
    queryKey: ["project-members", currentProjectId],
    queryFn: () =>
      authFetch<{ data: MembersResponse }>(`/api/projects/${currentProjectId}/members`).then((r) => r.data),
    enabled: !!currentProjectId,
    staleTime: 60_000,
  });

  // 첫 로드 시 담당자 필터 기본값을 "나"로 — 이후 사용자가 바꾸면 더 이상 덮어쓰지 않는다.
  useEffect(() => {
    if (!defaultApplied && membersData?.myMemberId) {
      setAssigneeId(membersData.myMemberId);
      setDefaultApplied(true);
    }
  }, [defaultApplied, membersData]);

  const members = (membersData?.members ?? []).map((m) => ({ memberId: m.memberId, name: m.name || m.email }));

  const { data, isLoading, error } = useQuery<MyTaskResponse>({
    queryKey: ["my-task", currentProjectId, view, sortBy, assigneeId, page, pageSize],
    queryFn: () =>
      authFetch<{ data: MyTaskResponse }>(
        `/api/projects/${currentProjectId}/my-task?view=${view}&sortBy=${sortBy}&page=${page}&pageSize=${pageSize}${assigneeId ? `&assigneeId=${assigneeId}` : ""}`
      ).then((r) => r.data),
    enabled: !!currentProjectId,
  });

  const handleChanged = () => {
    queryClient.invalidateQueries({ queryKey: ["my-task", currentProjectId] });
  };

  return (
    <div style={{ padding: 0 }}>
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 24px", position: "sticky", top: 0, zIndex: 10,
          background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)",
          marginBottom: 16, gap: 12, flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 19, fontWeight: 700, color: "var(--color-text-primary)" }}>
          ✅ My Task
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* 담당자 — 목록/그룹 둘 다 실제로 필터링됨. 그룹은 담당 항목을 품은 조상 가지만 남긴다
              (조상 노드 자체는 다른 사람 소유일 수 있음 — 위치를 보여주려고 같이 남는 것). */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>담당자</span>
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="sp-input"
              style={{ padding: "2px 6px", fontSize: "var(--text-base)", height: 26 }}
            >
              <option value="">전체</option>
              {members.map((m) => (
                <option key={m.memberId} value={m.memberId}>
                  {m.name}{m.memberId === membersData?.myMemberId ? " (나)" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* 보기 방식 — 목록(flat) / 그룹(tree) */}
          <div style={{ display: "flex", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
            {(["flat", "tree"] as MyTaskView[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                style={{
                  padding: "4px 10px", fontSize: "var(--text-base)", fontWeight: 600,
                  border: "none", cursor: "pointer",
                  background: view === v ? "var(--color-brand)" : "var(--color-bg-card)",
                  color: view === v ? "#fff" : "var(--color-text-secondary)",
                }}
              >
                {v === "flat" ? "목록" : "그룹"}
              </button>
            ))}
          </div>

          {/* 정렬 기준 — 목록은 전체를 한 줄로, 그룹은 형제 노드끼리만 재정렬 */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>정렬</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as MyTaskSortBy)}
              className="sp-input"
              style={{ padding: "2px 6px", fontSize: "var(--text-base)", height: 26 }}
            >
              <option value="deadline">마감일순</option>
              <option value="sortOrder">정렬순서</option>
            </select>
          </div>
        </div>
      </div>

      <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
        {!currentProjectId ? (
          <NoProjectSelected />
        ) : (
          <>
            {view === "flat" ? (
              <MyTaskFlatList
                nodes={data?.nodes ?? []}
                projectId={currentProjectId}
                members={members}
                onChanged={handleChanged}
                isLoading={isLoading}
                error={error as Error | null}
              />
            ) : (
              <MyTaskTree
                nodes={data?.nodes ?? []}
                projectId={currentProjectId}
                members={members}
                onChanged={handleChanged}
                isLoading={isLoading}
                error={error as Error | null}
              />
            )}

            <PaginationBar
              page={data?.page ?? page}
              totalPages={data?.totalPages ?? 1}
              totalCount={data?.totalCount ?? 0}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
              unitLabel={view === "flat" ? "건" : "개 단위업무"}
            />
          </>
        )}
      </div>
    </div>
  );
}

function PaginationBar({
  page, totalPages, totalCount, pageSize, onPageChange, onPageSizeChange, unitLabel,
}: {
  page: number; totalPages: number; totalCount: number; pageSize: PageSize;
  onPageChange: (p: number) => void; onPageSizeChange: (n: PageSize) => void;
  unitLabel: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, padding: "4px 4px" }}>
      <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-tertiary)" }}>
        총 {totalCount}{unitLabel}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>페이지당</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value) as PageSize)}
            className="sp-input"
            style={{ padding: "2px 6px", fontSize: "var(--text-base)", height: 26 }}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}개</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1} style={{ ...pageBtnStyle, opacity: page <= 1 ? 0.5 : 1 }}>이전</button>
          <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
            {page} / {totalPages}
          </span>
          <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} style={{ ...pageBtnStyle, opacity: page >= totalPages ? 0.5 : 1 }}>다음</button>
        </div>
      </div>
    </div>
  );
}

const pageBtnStyle: React.CSSProperties = {
  padding: "3px 10px", fontSize: "var(--text-base)", fontWeight: 600,
  border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
  background: "var(--color-bg-card)", color: "var(--color-text-secondary)",
  cursor: "pointer",
};

function NoProjectSelected() {
  return (
    <div
      className="sp-empty"
      style={{
        padding: "48px 24px", textAlign: "center",
        background: "var(--color-bg-card)", border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-card)",
      }}
    >
      <div className="sp-empty-icon">📁</div>
      <div className="sp-empty-title">프로젝트를 선택해 주세요</div>
      <div className="sp-empty-desc">
        상단 프로젝트 선택기에서 프로젝트를 고르면 My Task가 표시됩니다.
      </div>
    </div>
  );
}
