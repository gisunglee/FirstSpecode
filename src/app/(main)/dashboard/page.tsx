"use client";

/**
 * DashboardPage — 대시보드
 *
 * 역할:
 *   - 로그인 후 기본 진입 화면
 *   - 시간대별 인사 + 사용자 식별
 *   - 현재 프로젝트에서 내 담당 과업 요약 (있을 때만)
 *
 * URL: /dashboard
 */

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";

type MyProfile = { name: string; email: string };

type Task = { taskId: string };
type TasksResponse = { tasks: Task[]; totalCount: number };

// 시간대별 인사 — 24시간 기준
//   05~11: 좋은 아침이에요 ☀
//   12~17: 좋은 오후예요 ☀
//   18~22: 수고하셨어요 🌙
//   23~04: 안녕하세요 🌙
function timeBasedGreeting(): { text: string; emoji: string } {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return { text: "좋은 아침이에요", emoji: "☀" };
  if (h >= 12 && h < 18) return { text: "좋은 오후예요",   emoji: "☀" };
  if (h >= 18 && h < 23) return { text: "수고하셨어요",     emoji: "🌙" };
  return { text: "안녕하세요", emoji: "🌙" };
}

export default function DashboardPage() {
  const currentProjectId = useAppStore((s) => s.currentProjectId);

  // 프로필 — GNB 와 동일 queryKey 라 캐시 공유 (재호출 없음)
  const { data: myProfile } = useQuery<MyProfile>({
    queryKey: ["member", "profile"],
    queryFn:  () =>
      authFetch<{ data: MyProfile }>("/api/member/profile").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  // 현재 프로젝트의 내 담당 과업 — 프로젝트가 선택돼 있을 때만
  // 같은 queryKey 가 과업 목록 페이지(["tasks", projectId, "me"])와도 공유됨
  const { data: myTasks } = useQuery<TasksResponse>({
    queryKey: ["tasks", currentProjectId, "me"],
    queryFn:  () =>
      authFetch<{ data: TasksResponse }>(
        `/api/projects/${currentProjectId}/tasks?assignedTo=me`
      ).then((r) => r.data),
    enabled: !!currentProjectId,
    staleTime: 60 * 1000,
  });

  // 현재 프로젝트 이름 — GNB 와 동일 queryKey 공유
  type ProjectOption = { prjct_id: string; prjct_nm: string };
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
  const myTaskCount = myTasks?.totalCount ?? 0;

  return (
    <div style={{ padding: 0 }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)", marginBottom: 16 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
          대시보드
        </div>
      </div>

      <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
        {/* 환영 영역 — 시간대 인사 + 이름 + 한 줄 요약 */}
        <section
          style={{
            padding:    "24px 28px",
            background: "linear-gradient(135deg, var(--color-brand-subtle), var(--color-bg-card))",
            border:     "1px solid var(--color-brand-border)",
            borderRadius: "var(--radius-card)",
          }}
        >
          <h1
            style={{
              margin:    0,
              fontSize:  "var(--text-2xl, 24px)",
              fontWeight: 700,
              color:     "var(--color-text-heading)",
              lineHeight: 1.3,
            }}
          >
            {greeting.text}
            {displayName && (
              <>
                , <span style={{ color: "var(--color-brand)" }}>{displayName}</span>님
              </>
            )}{" "}
            <span style={{ fontSize: "0.9em" }}>{greeting.emoji}</span>
          </h1>

          {/* 컨텍스트 한 줄 — 프로젝트 + 담당 과업 건수 */}
          <p
            style={{
              margin:   "10px 0 0",
              fontSize: "var(--text-base)",
              color:    "var(--color-text-secondary)",
              lineHeight: 1.6,
            }}
          >
            {currentProjectName ? (
              myTaskCount > 0 ? (
                <>
                  현재{" "}
                  <strong style={{ color: "var(--color-text-primary)" }}>
                    {currentProjectName}
                  </strong>
                  에서 담당 과업{" "}
                  <strong style={{ color: "var(--color-brand)" }}>
                    {myTaskCount}건
                  </strong>
                  이 진행 중이에요.
                </>
              ) : (
                <>
                  현재{" "}
                  <strong style={{ color: "var(--color-text-primary)" }}>
                    {currentProjectName}
                  </strong>
                  에서 담당 중인 과업은 없습니다.
                </>
              )
            ) : (
              "좌측 메뉴에서 단위업무를 선택해 시작해 보세요."
            )}
          </p>
        </section>

        {/* 레이아웃 확인용 카드 — 시스템 점검용으로 유지 */}
        <div className="sp-group" style={{ maxWidth: 480 }}>
          <div className="sp-group-header">
            <span className="sp-group-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              시스템 상태
            </span>
          </div>
          <div className="sp-group-body">
            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
              레이아웃이 정상 렌더링되었습니다.
            </p>
            <p
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--color-text-tertiary)",
                marginTop: 8,
                fontFamily: "var(--font-mono)",
              }}
            >
              GNB · LNB · StatusBar · MainLayout ✓
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
