"use client";

/**
 * AdminUsersPage — 전체 사용자 목록 (/admin/users)
 *
 * 역할:
 *   - 검색·상태 필터·페이지네이션으로 전체 회원 탐색
 *   - 시스템 관리자(SUPER_ADMIN) 배지 노출
 *   - 사용자 강제 변경(정지 해제 등)은 후속 PR — 여기는 조회만.
 *
 * 설계:
 *   - 상태 필터는 MEMBER_STATUS 상수로 유지보수 용이
 *   - 검색은 150ms 디바운스 없이 Enter/포커스 해제 트리거 — 단순 구현 우선
 */

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

type UserItem = {
  mberId:        string;
  email:         string | null;
  name:          string | null;
  plan:          string;
  status:        string;
  isSystemAdmin: boolean;
  joinedAt:      string;
  withdrawnAt:   string | null;
  projectCount:  number;
};

type UsersResponse = {
  data: {
    items: UserItem[];
    pagination: { page: number; pageSize: number; totalCount: number; totalPages: number };
  };
};

// 회원 상태 코드 — 서버에서 사용하는 값과 일치해야 함 (tb_cm_member.mber_sttus_code)
const MEMBER_STATUS: Array<{ value: string; label: string }> = [
  { value: "",            label: "전체 상태" },
  { value: "ACTIVE",      label: "활성" },
  { value: "UNVERIFIED",  label: "미인증" },
  { value: "SUSPENDED",   label: "정지" },
  { value: "WITHDRAWN",   label: "탈퇴" },
];

const PAGE_SIZE = 50;

export default function AdminUsersPage() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch]           = useState("");
  const [status, setStatus]           = useState("");
  const [page,   setPage]             = useState(1);

  const query = useQuery<UsersResponse["data"]>({
    queryKey: ["admin", "users", { search, status, page }],
    queryFn: () =>
      authFetch<UsersResponse>(
        `/api/admin/users?search=${encodeURIComponent(search)}&status=${status}&page=${page}&pageSize=${PAGE_SIZE}`
      ).then((r) => r.data),
  });

  function applySearch() {
    setSearch(searchInput);
    setPage(1);
  }

  const items      = query.data?.items ?? [];
  const totalCount = query.data?.pagination.totalCount ?? 0;
  const totalPages = query.data?.pagination.totalPages ?? 1;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* 필터 바 */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="sp-input"
          type="text"
          placeholder="이메일 또는 이름 검색"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") applySearch(); }}
          onBlur={applySearch}
          style={{ minWidth: 240 }}
        />
        <select
          className="sp-input"
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          style={{ minWidth: 140 }}
        >
          {MEMBER_STATUS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <div style={{ marginLeft: "auto", fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
          총 {totalCount.toLocaleString()}명
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
              <Th>이메일</Th>
              <Th>이름</Th>
              <Th>플랜</Th>
              <Th>상태</Th>
              <Th>시스템 역할</Th>
              <Th>프로젝트</Th>
              <Th>가입일</Th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading && (
              <tr><Td colSpan={7} align="center">불러오는 중…</Td></tr>
            )}
            {!query.isLoading && items.length === 0 && (
              <tr><Td colSpan={7} align="center" muted>조건에 맞는 사용자가 없습니다.</Td></tr>
            )}
            {items.map((u) => (
              <tr key={u.mberId} style={{ borderBottom: "1px solid var(--color-border)" }}>
                <Td>
                  <Link
                    href={`/admin/users/${u.mberId}`}
                    style={{ color: "var(--color-text-primary)", textDecoration: "none" }}
                  >
                    {u.email ?? <span style={{ color: "var(--color-text-tertiary)" }}>(없음)</span>}
                  </Link>
                </Td>
                <Td>{u.name ?? <span style={{ color: "var(--color-text-tertiary)" }}>(없음)</span>}</Td>
                <Td>{u.plan}</Td>
                <Td><StatusBadge status={u.status} /></Td>
                <Td>
                  {u.isSystemAdmin ? (
                    <span style={{
                      fontSize: "var(--text-xs)",
                      fontWeight: 700,
                      padding: "1px 8px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--color-warning-subtle)",
                      color: "var(--color-warning)",
                      border: "1px solid var(--color-warning-border)",
                    }}>
                      SUPER_ADMIN
                    </span>
                  ) : (
                    <span style={{ color: "var(--color-text-tertiary)" }}>—</span>
                  )}
                </Td>
                <Td>{u.projectCount}</Td>
                <Td>{new Date(u.joinedAt).toLocaleDateString("ko-KR")}</Td>
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
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding:    "10px 12px",
        textAlign:  "left",
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
  children,
  colSpan,
  align,
  muted,
}: {
  children:  React.ReactNode;
  colSpan?:  number;
  align?:    "left" | "center";
  muted?:    boolean;
}) {
  return (
    <td
      colSpan={colSpan}
      style={{
        padding:   "10px 12px",
        textAlign: align ?? "left",
        color:     muted ? "var(--color-text-tertiary)" : "var(--color-text-primary)",
      }}
    >
      {children}
    </td>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label =
    MEMBER_STATUS.find((s) => s.value === status)?.label ?? status;
  const color =
    status === "ACTIVE"    ? "var(--color-success)" :
    status === "SUSPENDED" ? "var(--color-error)"   :
    status === "WITHDRAWN" ? "var(--color-text-tertiary)" :
                             "var(--color-text-secondary)";
  return (
    <span style={{ fontSize: "var(--text-xs)", color, fontWeight: 600 }}>
      {label}
    </span>
  );
}
