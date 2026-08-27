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
import { clearAuthTokensAcrossTabs } from "@/lib/authRefreshClient";
import {
  AUTH_COOKIE_MODE_HEADER,
  AUTH_COOKIE_MODE_VALUE,
} from "@/lib/authCookiePolicy";
import { usePermissions } from "@/hooks/useMyRole";
import { ROLE_LABEL } from "@/lib/permissions";
import type { ProjectOption } from "@/types/layout";
import ProjectAbbrChip from "@/components/ui/ProjectAbbrChip";

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
  // 전역 "단위업무 고정" — 세션 한정(persist 안 함). 화면/영역/기능 목록에 적용
  const pinnedUnitWorkId    = useAppStore((s) => s.pinnedUnitWorkId);
  const pinnedUnitWorkName  = useAppStore((s) => s.pinnedUnitWorkName);
  const setPinnedUnitWork   = useAppStore((s) => s.setPinnedUnitWork);
  const clearPinnedUnitWork = useAppStore((s) => s.clearPinnedUnitWork);
  // 전역 검색 — 돋보기 버튼 클릭 시 GlobalSearchDialog 오픈
  const setGlobalSearchOpen = useAppStore((s) => s.setGlobalSearchOpen);
  // 사이드바 "<" 버튼 3연타 접기 모드 — 기본 꺼짐(클릭 1번으로 즉시 토글)
  const tripleClickToggleEnabled  = useAppStore((s) => s.tripleClickToggleEnabled);
  const toggleTripleClickToggle   = useAppStore((s) => s.toggleTripleClickToggle);

  // 프로젝트 드롭다운 열림 상태
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 단위업무 고정 드롭다운 — 열림 상태 + 검색어
  const [pinDropdownOpen, setPinDropdownOpen] = useState(false);
  const [pinSearch, setPinSearch] = useState("");
  const pinRef = useRef<HTMLDivElement>(null);

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

  // 단위업무 고정 드롭다운용 목록 — 현재 프로젝트의 단위업무 전체 (검색은 클라이언트에서)
  const { data: unitWorksForPin = [] } = useQuery<Array<{ unitWorkId: string; displayId: string; name: string }>>({
    queryKey: ["unit-works-for-pin", currentProjectId],
    queryFn: () =>
      authFetch<{ data: { items: Array<{ unitWorkId: string; displayId: string; name: string }> } }>(
        `/api/projects/${currentProjectId}/unit-works`
      ).then((res) => res.data.items ?? []),
    enabled: !!currentProjectId,
    staleTime: 60 * 1000,
  });
  const filteredUnitWorksForPin = pinSearch.trim()
    ? unitWorksForPin.filter((uw) =>
        uw.name.toLowerCase().includes(pinSearch.toLowerCase()) ||
        uw.displayId.toLowerCase().includes(pinSearch.toLowerCase()))
    : unitWorksForPin;

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

  // 현재 프로젝트의 내 역할 — GNB 우측 식별 칩에 노출 ("이지성 · 소유자")
  // 프로젝트 미선택이거나 멤버 아닌 상태면 myRole = null → 역할 부분 미노출
  const { myRole } = usePermissions(currentProjectId);
  const displayName = myProfile?.name?.trim() || myProfile?.email?.split("@")[0] || "";
  const roleLabel   = myRole ? ROLE_LABEL[myRole] : null;

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

  // ── URL → currentProjectId 동기화 ─────────────────────────────────────────
  // 외부 링크·북마크·지원 세션 등으로 /projects/{id}/* 에 직접 진입했을 때
  // GNB 셀렉터/LNB 서브메뉴가 모두 currentProjectId 기반으로 그려지므로
  // URL 의 projectId 와 전역 상태가 어긋나면 다른 프로젝트의 LNB 가 보인다.
  // 여기서 한 방향(URL → state) 으로 강제 동기화 — 본인 멤버십 밖 프로젝트
  // (예: SUPER_ADMIN 지원 세션) 도 컨텍스트 전환이 정상 동작.
  useEffect(() => {
    const m = pathname.match(/^\/projects\/([^/]+)/);
    const urlPrjctId = m?.[1];
    const selectedProjectId = useAppStore.getState().currentProjectId;
    if (urlPrjctId && urlPrjctId !== selectedProjectId) {
      setCurrentProjectId(urlPrjctId);
    }
  }, [pathname, setCurrentProjectId]);

  // 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
      if (pinRef.current && !pinRef.current.contains(e.target as Node)) {
        setPinDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 로그아웃 처리
  async function handleLogout() {
    setProfileOpen(false);
    try {
      const response = await fetch("/api/auth/logout", {
        method:  "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          [AUTH_COOKIE_MODE_HEADER]: AUTH_COOKIE_MODE_VALUE,
        },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        toast.error("로그아웃 처리에 실패했습니다. 다시 시도해 주세요.");
        return;
      }
    } catch {
      toast.error("서버에 연결하지 못해 로그아웃하지 못했습니다. 다시 시도해 주세요.");
      return;
    }
    clearAuthTokensAcrossTabs();

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
    setDropdownOpen(false);

    // /projects/{uuid} 로 시작하는 경우에만 URL 재작성
    const match = pathname.match(/^\/projects\/[^/]+(\/[^/]+)?/);
    if (match) {
      const section = match[1] ?? "";  // "/screens" 등, 없으면 빈 문자열
      router.push(`/projects/${id}${section}`);
      return;
    }

    // 프로젝트 경로 밖에서는 URL이 프로젝트 컨텍스트를 표현하지 않으므로
    // 선택값을 전역 상태에 바로 반영한다. 프로젝트 경로 안에서는 위 navigation이
    // 완료된 뒤 URL → state effect가 반영해야 이전 URL이 새 선택을 되돌리지 않는다.
    setCurrentProjectId(id);
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
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span>{currentProject?.prjct_nm ?? "프로젝트 선택"}</span>
              <ProjectAbbrChip value={currentProject?.prjct_abrv} />
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
                    <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.prjct_nm}
                      </span>
                      <ProjectAbbrChip value={p.prjct_abrv} />
                    </span>
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

        {/* 단위업무 고정 — 화면/영역/기능 목록을 하나의 단위업무로 제한해서 봄.
            프로젝트가 선택된 상태에서만 의미가 있으므로 currentProjectId 있을 때만 노출. */}
        {currentProjectId && (
          <>
            <span className="sp-menu-sep" />
            <div ref={pinRef} style={{ position: "relative" }}>
              {pinnedUnitWorkId ? (
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <button
                    className="sp-menu-item"
                    onClick={() => setPinDropdownOpen((o) => !o)}
                    title="다른 단위업무로 변경"
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      background: "var(--color-brand-subtle)",
                      color: "var(--color-brand)",
                      border: "1px solid var(--color-brand-border)",
                      maxWidth: 200,
                    }}
                  >
                    <span aria-hidden="true" style={{ fontSize: 11 }}>🔒</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {pinnedUnitWorkName}
                    </span>
                  </button>
                  <button
                    className="sp-menu-item"
                    onClick={() => clearPinnedUnitWork()}
                    title="단위업무 고정 해제"
                    style={{ padding: "2px 7px", color: "var(--color-text-tertiary)" }}
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  className="sp-menu-item"
                  onClick={() => setPinDropdownOpen((o) => !o)}
                  title="단위업무 고정 — 화면·영역·기능 목록을 하나의 단위업무로 제한해서 봅니다"
                  style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--color-text-secondary)" }}
                >
                  <span aria-hidden="true" style={{ fontSize: 11 }}>📌</span>
                  단위업무 고정
                </button>
              )}

              {pinDropdownOpen && (
                <div style={{
                  position: "absolute", top: "calc(100% + 4px)", left: 0,
                  width: 280, maxHeight: 360,
                  display: "flex", flexDirection: "column",
                  background: "var(--color-bg-card)",
                  border: "1px solid var(--color-border-strong)",
                  borderRadius: "var(--radius-card)",
                  boxShadow: "var(--shadow-md)",
                  zIndex: 100, overflow: "hidden",
                }}>
                  <input
                    autoFocus
                    value={pinSearch}
                    onChange={(e) => setPinSearch(e.target.value)}
                    placeholder="단위업무 검색..."
                    style={{
                      margin: 8, padding: "6px 10px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--color-border)",
                      background: "var(--color-bg-elevated)",
                      color: "var(--color-text-primary)",
                      fontSize: "var(--text-sm)",
                      outline: "none",
                    }}
                  />
                  <div style={{ overflowY: "auto", padding: "0 0 4px" }}>
                    {pinnedUnitWorkId && (
                      <button
                        onClick={() => { clearPinnedUnitWork(); setPinDropdownOpen(false); setPinSearch(""); }}
                        style={{
                          display: "block", width: "100%", padding: "7px 14px",
                          fontSize: "var(--text-md)", color: "var(--color-text-secondary)",
                          background: "none", border: "none", cursor: "pointer", textAlign: "left",
                        }}
                      >
                        전체 보기 (고정 해제)
                      </button>
                    )}
                    {filteredUnitWorksForPin.length === 0 ? (
                      <div style={{ padding: "10px 14px", fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
                        검색 결과가 없습니다.
                      </div>
                    ) : (
                      filteredUnitWorksForPin.map((uw) => (
                        <button
                          key={uw.unitWorkId}
                          onClick={() => { setPinnedUnitWork(uw.unitWorkId, uw.name); setPinDropdownOpen(false); setPinSearch(""); }}
                          style={{
                            display: "flex", width: "100%", alignItems: "center", gap: 8,
                            padding: "7px 14px", fontSize: "var(--text-md)",
                            color: uw.unitWorkId === pinnedUnitWorkId ? "var(--color-brand)" : "var(--color-text-secondary)",
                            background: uw.unitWorkId === pinnedUnitWorkId ? "var(--color-brand-subtle)" : "transparent",
                            border: "none", cursor: "pointer", textAlign: "left",
                          }}
                        >
                          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>
                            {uw.displayId}
                          </span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {uw.name}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

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

      {/* 우측: 사용자 식별 칩 + 테마 스위처 + 유틸리티 */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {/* 사용자 식별 칩 — "이지성 · 소유자" 형식.
            아바타 hover/클릭 없이도 즉시 "내가 누구로 어느 역할인지" 인지 가능.
            좁은 화면에서는 잘리지 않도록 max-width + ellipsis. 프로필 미로드 시 미노출. */}
        {displayName && (
          <div
            title={`${displayName}${roleLabel ? ` · ${roleLabel}` : ""}${myProfile?.email ? `\n${myProfile.email}` : ""}`}
            style={{
              display:      "flex",
              alignItems:   "center",
              gap:          6,
              padding:      "0 10px 0 8px",
              marginRight:  4,
              maxWidth:     220,
              fontSize:     "var(--text-sm)",
              color:        "var(--color-text-secondary)",
              borderRight:  "1px solid var(--color-border)",
              lineHeight:   1.2,
              whiteSpace:   "nowrap",
              overflow:     "hidden",
            }}
          >
            <span
              style={{
                fontWeight:   500,
                color:        "var(--color-text-primary)",
                overflow:     "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {displayName}
            </span>
            {roleLabel && (
              <>
                <span style={{ color: "var(--color-text-tertiary)" }}>·</span>
                <span
                  style={{
                    fontSize:   "var(--text-xs)",
                    fontWeight: 600,
                    padding:    "1px 6px",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--color-brand-subtle)",
                    color:      "var(--color-brand)",
                    flexShrink: 0,
                  }}
                >
                  {roleLabel}
                </span>
              </>
            )}
          </div>
        )}

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

        {/* 사이드바 "<" 버튼 3연타 접기 모드 on/off — LNB.tsx의 useTripleClickSidebarToggle이
            이 값을 읽어 리스너를 켜고 끈다. 텍스트 배지로 표시 — 아이콘보다 기능이 바로 읽혀서. */}
        <button
          className="sp-menu-item"
          title={
            tripleClickToggleEnabled
              ? "켜짐: 사이드바 접기 버튼을 3번 빠르게 눌러야 접힘/펼침이 전환돼요 (실수 방지)"
              : "꺼짐: 사이드바 접기 버튼은 클릭 1번으로 바로 접힘/펼침이 전환돼요. 클릭하면 3연타 모드로 전환합니다."
          }
          onClick={toggleTripleClickToggle}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            padding: "2px 8px",
            borderRadius: "var(--radius-sm)",
            background: tripleClickToggleEnabled ? "var(--color-brand-subtle)" : "transparent",
            color:      tripleClickToggleEnabled ? "var(--color-brand)" : "var(--color-text-secondary)",
            border:     tripleClickToggleEnabled ? "1px solid var(--color-brand-border)" : "1px solid transparent",
            fontSize:   "var(--text-xs)",
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          3연타
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

// 배지 색 — 예전엔 유형별 무지개색(UW=파랑/SCR·PID=초록/AR=주황/FN=보라 등)이었으나
// "진지한 프로그램인데 색이 너무 애들 같다"는 피드백으로 전부 중립 회색으로 통일하고,
// 마지막(현재 위치) 항목만 브랜드 컬러로 강조하는 방식으로 변경(2026-07-29)
function getBadgeColor(isLast: boolean): { bg: string; color: string } {
  return isLast
    ? { bg: "var(--color-brand-subtle)", color: "var(--color-brand)" }
    : { bg: "var(--color-bg-muted)", color: "var(--color-text-secondary)" };
}

function BreadcrumbChip({ label, href, tag, isLast, onNavigate }: {
  label:      string;
  href?:      string;
  tag?:       string;
  isLast:     boolean;
  onNavigate: (href: string) => void;
}) {
  const { badge, rest } = detectChipType(label);
  const color = getBadgeColor(isLast);
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
        <span className="sp-badge" style={{
          fontSize: 10, fontWeight: 600,
          padding: "1px 5px", borderRadius: 3,
          background: color.bg, color: color.color,
          letterSpacing: "0.02em",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}>
          {tag}
        </span>
      )}
      {badge && (
        <span className="sp-badge" style={{
          fontSize: 10, fontWeight: 700,
          padding: "1px 5px", borderRadius: 3,
          background: color.bg, color: color.color,
          fontFamily: "monospace", letterSpacing: "0.02em",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}>
          {badge}
        </span>
      )}
      {/* 이름 — 노트북처럼 좁은 화면에서 긴 단위업무명 등이 브레드크럼 전체를 밀어내지
          않도록 말줄임 처리. title 툴팁으로 전체 이름은 계속 확인 가능(2026-07-29) */}
      <span
        title={rest}
        style={{
          color: isCurrent ? "var(--color-text-primary)" : "var(--color-text-secondary)",
          fontWeight: isCurrent ? 700 : 400,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: 140,
        }}
      >
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
