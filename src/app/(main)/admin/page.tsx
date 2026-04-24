"use client";

/**
 * AdminDashboardPage — /admin 진입 시 첫 화면
 *
 * 역할:
 *   - 활성 지원 세션 요약 (관리자 본인의 현재 세션)
 *   - 사용자 수 / 프로젝트 수 간단 집계 (별도 API 없이 목록 API 의 count 재사용)
 *   - 관리 페이지로의 빠른 링크
 *
 * 구현 원칙:
 *   - 별도 /api/admin/stats 를 새로 만들지 않고, 기존 리스트 API 의
 *     pagination.totalCount 만 뽑아서 집계로 사용 (신규 코드 최소화).
 *   - 데이터가 없는 신규 관리자도 의미있는 화면이 보이도록 빈 상태 처리.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

type SupportSession = {
  sessId:    string;
  projectId: string;
  memo:      string | null;
  expiresAt: string;
  createdAt: string;
};

type CountOnlyResponse = {
  data: { pagination: { totalCount: number } };
};

export default function AdminDashboardPage() {
  // 활성 지원 세션 (관리자 본인)
  const { data: activeSessions = [] } = useQuery<SupportSession[]>({
    queryKey: ["admin", "support-sessions", "active"],
    queryFn: () =>
      authFetch<{ data: { items: SupportSession[] } }>(
        "/api/admin/support-session"
      ).then((r) => r.data.items ?? []),
    refetchInterval: 60 * 1000, // 1분마다 갱신 — 만료 반영
  });

  // 사용자 수 / 프로젝트 수 — 첫 페이지 1건만 가져와 totalCount 만 활용
  const { data: userCount = 0 } = useQuery<number>({
    queryKey: ["admin", "users", "count"],
    queryFn: () =>
      authFetch<CountOnlyResponse>("/api/admin/users?page=1&pageSize=1")
        .then((r) => r.data.pagination.totalCount),
    staleTime: 5 * 60 * 1000,
  });
  const { data: projectCount = 0 } = useQuery<number>({
    queryKey: ["admin", "projects", "count"],
    queryFn: () =>
      authFetch<CountOnlyResponse>("/api/admin/projects?page=1&pageSize=1")
        .then((r) => r.data.pagination.totalCount),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div style={{ display: "grid", gap: 24 }}>
      {/* 집계 카드 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <StatCard label="전체 사용자"        value={userCount}           href="/admin/users"    />
        <StatCard label="전체 프로젝트"      value={projectCount}        href="/admin/projects" />
        <StatCard label="내 활성 지원 세션"  value={activeSessions.length} href="#" />
      </div>

      {/* 활성 지원 세션 */}
      <section>
        <h2 style={{ fontSize: "var(--text-md)", marginBottom: 12, color: "var(--color-text-heading)" }}>
          현재 열린 지원 세션
        </h2>
        {activeSessions.length === 0 ? (
          <div
            style={{
              padding:    24,
              textAlign:  "center",
              fontSize:   "var(--text-sm)",
              color:      "var(--color-text-tertiary)",
              background: "var(--color-bg-elevated)",
              border:     "1px solid var(--color-border)",
              borderRadius: "var(--radius-card)",
            }}
          >
            열려있는 세션이 없습니다. 프로젝트 목록에서 지원이 필요한 프로젝트에 세션을 시작하세요.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {activeSessions.map((s) => (
              <SessionRow key={s.sessId} session={s} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value, href }: { label: string; value: number; href: string }) {
  const content = (
    <div
      style={{
        padding:      20,
        background:   "var(--color-bg-card)",
        border:       "1px solid var(--color-border)",
        borderRadius: "var(--radius-card)",
      }}
    >
      <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: "var(--color-text-heading)" }}>
        {value.toLocaleString()}
      </div>
    </div>
  );
  if (href === "#") return content;
  return (
    <Link href={href} style={{ textDecoration: "none" }}>
      {content}
    </Link>
  );
}

function SessionRow({ session }: { session: SupportSession }) {
  const expiresAt = new Date(session.expiresAt);
  const remaining = Math.max(0, expiresAt.getTime() - Date.now());
  const minLeft   = Math.floor(remaining / 60000);

  return (
    <div
      style={{
        display:      "flex",
        alignItems:   "center",
        justifyContent: "space-between",
        padding:      "10px 14px",
        background:   "var(--color-warning-subtle)",
        border:       "1px solid var(--color-warning-border)",
        borderRadius: "var(--radius-sm)",
        fontSize:     "var(--text-sm)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ color: "var(--color-text-primary)" }}>
          프로젝트 <code style={{ fontFamily: "var(--font-mono)" }}>{session.projectId.slice(0, 8)}</code>
          {session.memo && <span style={{ color: "var(--color-text-tertiary)" }}> · {session.memo}</span>}
        </div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
          {minLeft}분 남음 · {expiresAt.toLocaleTimeString("ko-KR")} 만료
        </div>
      </div>
      <Link
        href={`/projects/${session.projectId}`}
        style={{
          padding:     "4px 10px",
          fontSize:    "var(--text-xs)",
          color:       "var(--color-brand)",
          background:  "var(--color-bg-card)",
          border:      "1px solid var(--color-brand-border)",
          borderRadius:"var(--radius-sm)",
          textDecoration:"none",
        }}
      >
        프로젝트로 이동
      </Link>
    </div>
  );
}
