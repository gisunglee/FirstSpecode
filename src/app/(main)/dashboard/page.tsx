"use client";

/**
 * DashboardPage — 로그인 후 기본 진입 화면
 *
 * 역할:
 *   - 시간대별 인사 + 사용자 식별 (헤더)
 *   - 관리뷰/개발자뷰 토글 (역할 자동 분기 + 사용자 토글 + localStorage)
 *   - 선택된 뷰의 카드 그리드 렌더 (3개 카드 / 뷰)
 *
 * 두 뷰의 차이:
 *   - 관리(manage): 프로젝트 전반 — 진행률 / 정체 / 최근 변경
 *   - 개발자(me)  : 내 일 중심 — 내 과업 / 마감 / 내 AI 결과
 *
 * URL: /dashboard?view=manage|me
 *
 * 주요 기술:
 *   - TanStack Query: 통합 summary 엔드포인트 호출 (staleTime 5분)
 *   - useSearchParams (Suspense 내부에서만)
 */

import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";

import { useDashboardView } from "./_components/useDashboardView";
import ViewToggle    from "./_components/ViewToggle";
import ManageView    from "./_components/ManageView";
import DeveloperView from "./_components/DeveloperView";

type MyProfile     = { name: string; email: string };
type ProjectOption = { prjct_id: string; prjct_nm: string };

// 시간대별 인사 — 24시간 기준 (기존 로직 유지)
function timeBasedGreeting(): { text: string; emoji: string } {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return { text: "좋은 아침이에요", emoji: "☀" };
  if (h >= 12 && h < 18) return { text: "좋은 오후예요",   emoji: "☀" };
  if (h >= 18 && h < 23) return { text: "수고하셨어요",     emoji: "🌙" };
  return { text: "안녕하세요", emoji: "🌙" };
}

// useSearchParams 를 쓰는 Inner 컴포넌트는 반드시 Suspense 안에 있어야 함
// (Next.js 16 + use client 조합의 강제 제약)
export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardInner />
    </Suspense>
  );
}

function DashboardInner() {
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const { view, setView } = useDashboardView(currentProjectId);

  // 프로필 — GNB 와 동일 queryKey 라 캐시 공유 (재호출 없음)
  const { data: myProfile } = useQuery<MyProfile>({
    queryKey: ["member", "profile"],
    queryFn:  () => authFetch<{ data: MyProfile }>("/api/member/profile").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  // 현재 프로젝트 이름 — GNB 와 동일 queryKey 공유
  const { data: projects = [] } = useQuery<ProjectOption[]>({
    queryKey: ["projects", "my"],
    queryFn:  () =>
      authFetch<{ data: { items: ProjectOption[] } }>("/api/projects/my").then(
        (r) => r.data.items ?? []
      ),
    staleTime: 60 * 1000,
  });
  const currentProjectName = projects.find((p) => p.prjct_id === currentProjectId)?.prjct_nm;

  const displayName = myProfile?.name?.trim() || myProfile?.email?.split("@")[0] || "";
  const greeting    = timeBasedGreeting();

  return (
    <div style={{ padding: 0 }}>
      {/* ── 헤더 ────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 24px", position: "sticky", top: 0, zIndex: 10,
          background: "var(--color-bg-card)",
          borderBottom: "1px solid var(--color-border)",
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
          대시보드
        </div>
      </div>

      <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
        {/* ── 환영 영역 — 시간대 인사 + 이름 + 컨텍스트 한 줄 ──── */}
        <section
          style={{
            padding: "20px 24px",
            background: "linear-gradient(135deg, var(--color-brand-subtle), var(--color-bg-card))",
            border: "1px solid var(--color-brand-border)",
            borderRadius: "var(--radius-card)",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div style={{ flex: 1, minWidth: 240 }}>
            <h1
              style={{
                margin: 0,
                fontSize: "var(--text-2xl, 24px)",
                fontWeight: 700,
                color: "var(--color-text-heading)",
                lineHeight: 1.3,
              }}
            >
              {greeting.text}
              {displayName && (
                <>
                  ,{" "}
                  <span style={{ color: "var(--color-brand)" }}>{displayName}</span>님
                </>
              )}{" "}
              <span style={{ fontSize: "0.9em" }}>{greeting.emoji}</span>
            </h1>
            <p
              style={{
                margin: "8px 0 0",
                fontSize: "var(--text-base)",
                color: "var(--color-text-secondary)",
                lineHeight: 1.5,
              }}
            >
              {currentProjectName ? (
                <>
                  현재{" "}
                  <strong style={{ color: "var(--color-text-primary)" }}>
                    {currentProjectName}
                  </strong>
                  에서 작업 중이에요.
                </>
              ) : (
                "상단에서 프로젝트를 먼저 선택해 주세요."
              )}
            </p>
          </div>

          {/* 뷰 토글 — 프로젝트가 선택된 경우에만 노출 */}
          {currentProjectId && view && (
            <ViewToggle view={view} onChange={setView} />
          )}
        </section>

        {/* ── 카드 그리드 — 선택된 뷰만 렌더 ───────────────────── */}
        {currentProjectId ? (
          view === "manage" ? (
            <ManageView projectId={currentProjectId} />
          ) : view === "me" ? (
            <DeveloperView projectId={currentProjectId} />
          ) : (
            // view 결정 중 (역할 로딩) — 빈 그리드로 자리만 잡음
            <DashboardSkeleton />
          )
        ) : (
          <NoProjectSelected />
        )}
      </div>
    </div>
  );
}

// ─── 상태 컴포넌트 ───────────────────────────────────────────────────────────

function DashboardSkeleton() {
  // view 결정 전 깜빡임 방지 — 카드 셸 3개 자리만 잡아둠
  return (
    <div className="sp-dashboard-grid">
      {[0, 1, 2].map((i) => (
        <div key={i} className="sp-group" style={{ minHeight: 220 }}>
          <div className="sp-group-header">
            <div className="sp-group-title" style={{ opacity: 0.4 }}>로딩 중…</div>
          </div>
          <div className="sp-group-body" />
        </div>
      ))}
    </div>
  );
}

function NoProjectSelected() {
  return (
    <div
      className="sp-empty"
      style={{
        padding: "48px 24px",
        textAlign: "center",
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-card)",
      }}
    >
      <div className="sp-empty-icon">📁</div>
      <div className="sp-empty-title">프로젝트를 선택해 주세요</div>
      <div className="sp-empty-desc">
        상단 프로젝트 선택기에서 프로젝트를 고르면 대시보드가 표시됩니다.
      </div>
    </div>
  );
}
