"use client";

/**
 * GNB — 글로벌 상단 내비게이션 바 (AR-00094)
 *
 * 역할:
 *   - 로고 클릭 → 대시보드 이동
 *   - 프로젝트 셀렉터: 내 프로젝트 목록 드롭다운, 선택 시 전역 상태 갱신 (FID-00202)
 *   - 테마 스위처: light ↔ dark 토글 (FID-00203)
 *   - 유틸리티 영역: 알림, 설정, 프로필 (현재는 플레이스홀더)
 *
 * 주요 기술:
 *   - TanStack Query: 프로젝트 목록 조회 및 캐시
 *   - Zustand: currentProjectId, theme 전역 상태
 *   - sp-menubar CSS 클래스 사용 (SPECODE 디자인 시스템)
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/store/appStore";
import { authFetch } from "@/lib/authFetch";
import type { ProjectOption } from "@/types/layout";

/** GNB 프로필 드롭다운 표시용 — /api/member/profile GET 응답 중 사용하는 필드만 */
type MyProfile = {
  name:             string;
  email:            string;
  profileImage:     string | null;
  plan:             string;  // 시스템 플랜: FREE / PRO / TEAM / ENTERPRISE
  assigneeViewMode: "all" | "me";  // 전역 담당자 필터 모드 — GNB 토글 초기값
  isSystemAdmin:    boolean; // SUPER_ADMIN 여부 — 드롭다운에 "시스템 관리" 링크 노출
};

export default function GNB() {
  const router   = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { currentProjectId, setCurrentProjectId, theme, toggleTheme, breadcrumb } =
    useAppStore();
  // 전역 "내 담당" 모드 — 서버(DB)에서 로드, GNB 토글로 변경
  const myAssigneeMode      = useAppStore((s) => s.myAssigneeMode);
  const setMyAssigneeMode   = useAppStore((s) => s.setMyAssigneeMode);
  const setHasLoadedProfile = useAppStore((s) => s.setHasLoadedProfile);
  // 전역 검색 — 돋보기 버튼 클릭 시 GlobalSearchDialog 오픈
  const setGlobalSearchOpen = useAppStore((s) => s.setGlobalSearchOpen);

  // 프로젝트 드롭다운 열림 상태
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 프로필 드롭다운 열림 상태
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  // 내 프로젝트 목록 조회 — 첫 마운트 시 1회 + 5분 캐시
  const { data: projects = [] } = useQuery<ProjectOption[]>({
    queryKey: ["projects", "my"],
    queryFn: () =>
      authFetch<{ data: { items: ProjectOption[] } }>("/api/projects/my").then(
        (res) => res.data.items ?? []
      ),
    staleTime: 60 * 1000, // 1분
  });

  // 내 프로필 조회 — 아바타 이니셜/이름/이메일/플랜 표시용
  // (프로필 설정 페이지에서 이미 동일 API 사용 → 캐시 공유)
  const { data: myProfile } = useQuery<MyProfile>({
    queryKey: ["member", "profile"],
    queryFn: () =>
      authFetch<{ data: MyProfile }>("/api/member/profile").then((res) => res.data),
    staleTime: 5 * 60 * 1000, // 5분
  });

  // 프로필 도착 시 전역 myAssigneeMode 동기화 + 로드 완료 플래그 세팅
  // → 5개 목록 페이지의 useQuery가 _hasLoadedProfile을 기다려 쿼리 지연(플리커 방지)
  useEffect(() => {
    if (myProfile) {
      setMyAssigneeMode(myProfile.assigneeViewMode ?? "all");
      setHasLoadedProfile(true);
    }
  }, [myProfile, setMyAssigneeMode, setHasLoadedProfile]);

  // 아바타 이니셜 — 이름 첫 글자 > 이메일 첫 글자 > "?"
  const avatarInitial = (myProfile?.name?.trim()?.[0]
    ?? myProfile?.email?.trim()?.[0]
    ?? "?").toUpperCase();

  // 전역 "내 담당" 모드 토글 — 낙관적 업데이트 + 서버 PATCH + 실패 시 롤백
  function toggleMyAssigneeMode() {
    const prev = myAssigneeMode;
    const next: "all" | "me" = prev === "me" ? "all" : "me";
    setMyAssigneeMode(next);
    authFetch("/api/member/profile/assignee-view", {
      method: "PATCH",
      body:   JSON.stringify({ mode: next }),
    }).catch((err: Error) => {
      setMyAssigneeMode(prev);
      toast.error("설정 저장 실패: " + err.message);
    });
  }

  // 현재 선택된 프로젝트 이름 계산
  const currentProject = projects.find(
    (p) => p.prjct_id === currentProjectId
  );

  // 프로젝트가 있고 현재 선택된 게 없으면 첫 번째 프로젝트를 자동 선택
  useEffect(() => {
    if (!currentProjectId && projects.length > 0) {
      setCurrentProjectId(projects[0]!.prjct_id);
    }
  }, [projects, currentProjectId, setCurrentProjectId]);

  // 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 로그아웃 처리
  async function handleLogout() {
    setProfileOpen(false);
    const rt = sessionStorage.getItem("refresh_token")
            ?? localStorage.getItem("lc_refresh_token")
            ?? "";
    try {
      await fetch("/api/auth/logout", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ refreshToken: rt }),
      });
    } catch {
      // 서버 오류여도 클라이언트 토큰은 제거
    }
    sessionStorage.removeItem("access_token");
    sessionStorage.removeItem("refresh_token");
    localStorage.removeItem("lc_refresh_token");

    // React Query 캐시 전체 초기화.
    // QueryClient 인스턴스는 앱 수명 동안 유지되므로, 로그아웃 후 재로그인 시
    // 이전 사용자의 ["member","profile"] / ["projects","my"] / ["my-role"] 등
    // 캐시가 그대로 노출되는 문제가 있다. 계정 교차 오염 방지를 위해 전체 clear.
    queryClient.clear();

    // Zustand 메모리 상태도 초기화 — currentProjectId 등이 남아있으면
    // 새 사용자 화면에 이전 프로젝트 ID가 잠깐 깔릴 수 있음.
    setCurrentProjectId(null);
    useAppStore.getState().setBreadcrumb([]);
    useAppStore.getState().setHasLoadedProfile(false);
    useAppStore.getState().setMyAssigneeMode("all");

    toast.success("로그아웃되었습니다.");
    router.push("/auth/login");
  }

  // 프로젝트 선택 핸들러
  //
  // 전역 상태만 바꾸면 LNB 링크는 갱신되지만 현재 페이지는 여전히 이전 projectId를
  // URL 파라미터로 쥐고 있어 이전 프로젝트 데이터가 그대로 보이는 문제가 있다.
  //   → 현재 pathname이 `/projects/{oldId}/...` 패턴이면 같은 섹션을 유지한 채
  //     projectId만 교체해서 즉시 이동시킨다.
  //   → 단, 상세 경로(`/projects/{id}/screens/abc`)는 새 프로젝트에 해당 리소스가
  //     없을 수 있으므로 섹션 레벨(예: `/screens`)까지만 유지하고 하위 ID는 잘라냄.
  //   → 프로젝트 무관 경로(`/dashboard`, `/settings/profile`, `/projects` 등)는
  //     URL을 건드리지 않는다 — 사용자의 현재 맥락을 유지.
  function handleSelectProject(id: string) {
    setCurrentProjectId(id);
    setDropdownOpen(false);

    // /projects/{uuid} 로 시작하는 경우에만 URL 재작성
    const match = pathname.match(/^\/projects\/[^/]+(\/[^/]+)?/);
    if (match) {
      const section = match[1] ?? "";  // "/screens" 등, 없으면 빈 문자열
      router.push(`/projects/${id}${section}`);
    }
  }

  return (
    <header className="sp-menubar" style={{ justifyContent: "space-between", paddingLeft: "12px", paddingRight: "12px" }}>
      {/* 좌측: 로고 + 프로젝트 셀렉터 + 브레드크럼 */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {/* 로고 */}
        <Link
          href="/dashboard"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            textDecoration: "none",
            color: "var(--color-text-heading)",
            fontWeight: 700,
            fontSize: "var(--text-md)",
            letterSpacing: "0.04em",
          }}
        >
          <span
            style={{
              width: 16,
              height: 16,
              background: "var(--color-accent-subtle)",
              border: "1px solid var(--color-accent-border)",
              borderRadius: "var(--radius-sm)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
            }}
          >
            ⚡
          </span>
          SPECODE
        </Link>

        {/* 구분선 */}
        <span className="sp-menu-sep" />

        {/* 프로젝트 셀렉터 드롭다운 */}
        <div ref={dropdownRef} style={{ position: "relative" }}>
          <button
            className="sp-menu-item"
            onClick={() => setDropdownOpen((o) => !o)}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <span>
              {currentProject?.prjct_nm ?? "프로젝트 선택"}
            </span>
            <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
              ▾
            </span>
          </button>

          {/* 드롭다운 목록 */}
          {dropdownOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                minWidth: 200,
                background: "var(--color-bg-card)",
                border: "1px solid var(--color-border-strong)",
                borderRadius: "var(--radius-card)",
                boxShadow: "var(--shadow-md)",
                zIndex: 100,
                padding: "4px 0",
              }}
            >
              {projects.length === 0 ? (
                <div
                  style={{
                    padding: "8px 14px",
                    fontSize: "var(--text-sm)",
                    color: "var(--color-text-tertiary)",
                  }}
                >
                  참여 중인 프로젝트가 없습니다.
                </div>
              ) : (
                projects.map((p) => (
                  <button
                    key={p.prjct_id}
                    onClick={() => handleSelectProject(p.prjct_id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      width: "100%",
                      padding: "7px 14px",
                      fontSize: "var(--text-md)",
                      color:
                        p.prjct_id === currentProjectId
                          ? "var(--color-brand)"
                          : "var(--color-text-secondary)",
                      background:
                        p.prjct_id === currentProjectId
                          ? "var(--color-brand-subtle)"
                          : "transparent",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span>{p.prjct_nm}</span>
                    <span
                      style={{
                        fontSize: "var(--text-xs)",
                        color: "var(--color-text-tertiary)",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {p.role_code}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* 브레드크럼 — 페이지가 동적으로 설정, 프로젝트 셀렉터 바로 옆 */}
        {breadcrumb.length > 0 && (
          <>
            <span className="sp-menu-sep" />
            <nav style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              {breadcrumb.map((item, i) => {
                const isLast = i === breadcrumb.length - 1;
                return (
                  <span key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {i > 0 && (
                      <span style={{ color: "var(--color-text-tertiary)", opacity: 0.6, fontSize: 14, lineHeight: 1, userSelect: "none" }}>
                        ›
                      </span>
                    )}
                    <BreadcrumbChip label={item.label} href={item.href} tag={item.tag} isLast={isLast} onNavigate={(h) => router.push(h)} />
                  </span>
                );
              })}
            </nav>
          </>
        )}
      </div>

      {/* 우측: 테마 스위처 + 유틸리티 */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {/* 테마 토글 버튼 */}
        <button
          className="sp-menu-item"
          onClick={toggleTheme}
          title={`현재 테마: ${theme} — 클릭하여 전환`}
          style={{ fontSize: 14, padding: "2px 8px" }}
        >
          {theme === "light" ? "☾" : "☀"}
        </button>

        {/* "내 담당 모드" 토글 — 담당자 있는 모든 목록(단위업무/과업/요구사항/화면/DB 테이블)에 적용 */}
        {/* ON 상태는 브랜드색 배경으로 강조, OFF는 흐린 아이콘 */}
        <button
          className="sp-menu-item"
          onClick={toggleMyAssigneeMode}
          title={myAssigneeMode === "me"
            ? "내 담당 모드 (켜짐) — 클릭하여 끄기"
            : "내 담당만 보기 (꺼짐) — 클릭하여 켜기"}
          aria-pressed={myAssigneeMode === "me"}
          style={{
            padding:      "2px 6px",
            display:      "inline-flex",
            alignItems:   "center",
            justifyContent:"center",
            borderRadius: "var(--radius-sm)",
            background:   myAssigneeMode === "me" ? "var(--color-brand-subtle)" : "transparent",
            color:        myAssigneeMode === "me" ? "var(--color-brand)" : "var(--color-text-secondary)",
            border:       myAssigneeMode === "me" ? "1px solid var(--color-brand-border)" : "1px solid transparent",
          }}
        >
          {/* 사람 아이콘 (user outline) — 14px, currentColor로 테마 대응 */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </button>

        {/* 전역 검색 — 돋보기 아이콘, Ctrl+K 단축키로도 열림 (GlobalSearchDialog 참고) */}
        <button
          className="sp-menu-item"
          title="전역 검색 (Ctrl+K)"
          onClick={() => setGlobalSearchOpen(true)}
          style={{ display: "inline-flex", alignItems: "center", padding: "2px 8px" }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </button>

        {/* 프로필 아바타 + 드롭다운 */}
        <div ref={profileRef} style={{ position: "relative" }}>
          <button
            className="sp-menu-item"
            title={myProfile?.name || myProfile?.email || "프로필"}
            onClick={() => setProfileOpen((o) => !o)}
            style={{
              width: 22, height: 22,
              borderRadius: "var(--radius-full)",
              background: myProfile?.profileImage ? "transparent" : "var(--color-brand-subtle)",
              border: "1px solid var(--color-brand-border)",
              color: "var(--color-brand)",
              fontSize: "var(--text-xs)",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              overflow: "hidden",
            }}
          >
            {/* 프로필 이미지 있으면 이미지, 없으면 이름 첫 글자 이니셜 */}
            {myProfile?.profileImage
              ? <img src={myProfile.profileImage} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : avatarInitial}
          </button>

          {profileOpen && (
            <div style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              minWidth: 220,
              background: "var(--color-bg-card)",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "var(--radius-card)",
              boxShadow: "var(--shadow-md)",
              zIndex: 200,
              padding: "4px 0",
              overflow: "hidden",
            }}>
              {/* 사용자 식별 카드 — 이름·이메일·플랜 (시스템 권한) */}
              {/* 프로젝트 역할은 여기에 노출하지 않음 — 프로젝트 전환 시 내용이 바뀌면 혼란 */}
              <div style={{
                padding: "10px 14px",
                borderBottom: "1px solid var(--color-border)",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{
                  width: 34, height: 34,
                  borderRadius: "var(--radius-full)",
                  background: myProfile?.profileImage ? "transparent" : "var(--color-brand-subtle)",
                  border: "1px solid var(--color-brand-border)",
                  color: "var(--color-brand)",
                  fontSize: "var(--text-sm)",
                  fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  overflow: "hidden", flexShrink: 0,
                }}>
                  {myProfile?.profileImage
                    ? <img src={myProfile.profileImage} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : avatarInitial}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 6,
                    fontSize: "var(--text-md)", fontWeight: 600,
                    color: "var(--color-text-primary)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {myProfile?.name?.trim() || "이름 미설정"}
                    </span>
                    {myProfile?.plan && (
                      <span style={{
                        flexShrink: 0,
                        fontSize: "var(--text-xs)",
                        fontWeight: 600,
                        padding: "1px 6px",
                        borderRadius: "var(--radius-sm)",
                        background: "var(--color-brand-subtle)",
                        color: "var(--color-brand)",
                        lineHeight: 1.4,
                      }}>
                        {myProfile.plan}
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--color-text-tertiary)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    marginTop: 2,
                  }}>
                    {myProfile?.email ?? ""}
                  </div>
                </div>
              </div>
              <Link
                href="/settings/profile"
                onClick={() => setProfileOpen(false)}
                style={{
                  display: "block",
                  padding: "7px 14px",
                  fontSize: "var(--text-md)",
                  color: "var(--color-text-secondary)",
                  textDecoration: "none",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-bg-elevated)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                프로필 설정
              </Link>
              {/* MCP 키 관리 — 프로필 설정의 MCP 키 탭으로 직접 진입.
                  Claude Code 등 외부 클라이언트 연결 키 관리는 자주 쓰이므로 한 클릭에 노출 */}
              <Link
                href="/settings/profile?tab=api-keys"
                onClick={() => setProfileOpen(false)}
                style={{
                  display: "block",
                  padding: "7px 14px",
                  fontSize: "var(--text-md)",
                  color: "var(--color-text-secondary)",
                  textDecoration: "none",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-bg-elevated)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                MCP 키 관리
              </Link>
              {/* 시스템 관리 — SUPER_ADMIN 일 때만 노출.
                  일반 사용자에게는 /admin 경로의 존재 자체를 숨긴다. */}
              {myProfile?.isSystemAdmin && (
                <>
                  <div style={{ height: 1, background: "var(--color-border)", margin: "2px 0" }} />
                  <Link
                    href="/admin"
                    onClick={() => setProfileOpen(false)}
                    style={{
                      display:        "flex",
                      alignItems:     "center",
                      gap:            8,
                      padding:        "7px 14px",
                      fontSize:       "var(--text-md)",
                      color:          "var(--color-warning)",
                      fontWeight:     600,
                      textDecoration: "none",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-warning-subtle)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ fontSize: 10 }}>🛡️</span>
                    시스템 관리
                  </Link>
                </>
              )}
              <div style={{ height: 1, background: "var(--color-border)", margin: "2px 0" }} />
              <button
                onClick={handleLogout}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "7px 14px",
                  fontSize: "var(--text-md)",
                  color: "var(--color-error)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-error-subtle)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                로그아웃
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

// ── 브레드크럼 칩 ──────────────────────────────────────────────────────────────
// 라벨 prefix(UW-/SCR-/AR-/FN-/RQ-/PID-) 또는 "~ 목록" 키워드로 타입 자동 감지
// → 타입별 컬러 배지(prefix) + 이름으로 렌더링

type ChipType = "UW" | "SCR" | "AR" | "FN" | "RQ" | "PID" | "LIST" | "TEXT";

function detectChipType(label: string): { type: ChipType; badge: string; rest: string } {
  // "UW-00001 프로젝트 생성·관리" 형식 분리
  const m = label.match(/^(UW|SCR|AR|FN|RQ|PID)-(\d+)\s*(.*)$/);
  if (m) return { type: m[1] as ChipType, badge: `${m[1]}-${m[2]}`, rest: m[3] };
  // "~ 목록"
  if (label.endsWith("목록")) return { type: "LIST", badge: "", rest: label };
  return { type: "TEXT", badge: "", rest: label };
}

const CHIP_COLORS: Record<ChipType, { bg: string; color: string }> = {
  UW:   { bg: "#e3f2fd", color: "#1565c0" },  // 파랑
  SCR:  { bg: "#e8f5e9", color: "#2e7d32" },  // 초록
  PID:  { bg: "#e8f5e9", color: "#2e7d32" },  // 초록 (화면 동일)
  AR:   { bg: "#fff3e0", color: "#e65100" },  // 주황
  FN:   { bg: "#f3e5f5", color: "#6a1b9a" },  // 보라
  RQ:   { bg: "#eceff1", color: "#455a64" },  // 회색
  LIST: { bg: "#f5f5f5", color: "#757575" },  // 회색
  TEXT: { bg: "#f5f5f5", color: "#757575" },
};

// tag별 색상 — 브레드크럼 아이템에 tag 속성으로 전달
const TAG_COLORS: Record<string, { bg: string; color: string }> = {
  과업:       { bg: "#e3f2fd", color: "#1565c0" },
  요구사항:   { bg: "#eceff1", color: "#455a64" },
  스토리:     { bg: "#f3e5f5", color: "#6a1b9a" },
  화면:       { bg: "#e8f5e9", color: "#2e7d32" },
  영역:       { bg: "#fff3e0", color: "#e65100" },
  기능:       { bg: "#f3e5f5", color: "#6a1b9a" },
};

function BreadcrumbChip({ label, href, tag, isLast, onNavigate }: {
  label:      string;
  href?:      string;
  tag?:       string;
  isLast:     boolean;
  onNavigate: (href: string) => void;
}) {
  const { type, badge, rest } = detectChipType(label);
  const color = CHIP_COLORS[type];
  const tagColor = tag ? TAG_COLORS[tag] : undefined;
  const clickable = !!href;

  // 현재 위치 = href 없는 항목
  const isCurrent = !clickable;

  const content = (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "3px 10px", borderRadius: 14,
      fontSize: 12, lineHeight: 1.2,
      background: "transparent",
      border: "1px solid transparent",
      transition: "all 0.15s",
    }}>
      {/* tag 배지 — badge(ID prefix)가 없고 tag가 있을 때 표시 */}
      {!badge && tag && (
        <span style={{
          fontSize: 10, fontWeight: 600,
          padding: "1px 5px", borderRadius: 3,
          background: tagColor?.bg ?? "#f5f5f5",
          color: tagColor?.color ?? "#757575",
          letterSpacing: "0.02em",
          whiteSpace: "nowrap",
        }}>
          {tag}
        </span>
      )}
      {badge && (
        <span style={{
          fontSize: 10, fontWeight: 700,
          padding: "1px 5px", borderRadius: 3,
          background: color.bg, color: color.color,
          fontFamily: "monospace", letterSpacing: "0.02em",
        }}>
          {badge}
        </span>
      )}
      <span style={{
        color: isCurrent ? "var(--color-text-primary)" : "var(--color-text-secondary)",
        fontWeight: isCurrent ? 700 : 400,
      }}>
        {rest}
      </span>
    </span>
  );

  if (!clickable) return content;

  return (
    <button
      onClick={() => onNavigate(href!)}
      style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.7"; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
    >
      {content}
    </button>
  );
}
