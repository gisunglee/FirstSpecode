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
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useAppStore } from "@/store/appStore";
import { authFetch } from "@/lib/authFetch";
import type { ProjectOption } from "@/types/layout";

export default function GNB() {
  const router = useRouter();
  const { currentProjectId, setCurrentProjectId, theme, toggleTheme } =
    useAppStore();

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
    staleTime: 5 * 60 * 1000, // 5분
  });

  // 현재 선택된 프로젝트 이름 계산
  const currentProject = projects.find(
    (p) => p.prjct_id === currentProjectId
  );

  // 프로젝트가 1개뿐이고 선택된 게 없으면 자동 선택
  useEffect(() => {
    if (!currentProjectId && projects.length === 1) {
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
    toast.success("로그아웃되었습니다.");
    router.push("/auth/login");
  }

  // 프로젝트 선택 핸들러
  function handleSelectProject(id: string) {
    setCurrentProjectId(id);
    setDropdownOpen(false);
  }

  return (
    <header className="sp-menubar" style={{ justifyContent: "space-between", paddingLeft: "12px", paddingRight: "12px" }}>
      {/* 좌측: 로고 + 프로젝트 셀렉터 */}
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

        {/* AI 요약 버튼 (플레이스홀더) */}
        <button className="sp-menu-item" title="AI 프로젝트 요약 브리핑">
          ✨
        </button>

        {/* 알림 (플레이스홀더) */}
        <button className="sp-menu-item" title="알림">
          🔔
        </button>

        {/* 설정 (플레이스홀더) */}
        <button className="sp-menu-item" title="설정">
          ⚙️
        </button>

        {/* 프로필 아바타 + 드롭다운 */}
        <div ref={profileRef} style={{ position: "relative" }}>
          <button
            className="sp-menu-item"
            title="프로필"
            onClick={() => setProfileOpen((o) => !o)}
            style={{
              width: 22, height: 22,
              borderRadius: "var(--radius-full)",
              background: "var(--color-brand-subtle)",
              border: "1px solid var(--color-brand-border)",
              color: "var(--color-brand)",
              fontSize: "var(--text-xs)",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            P
          </button>

          {profileOpen && (
            <div style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              minWidth: 160,
              background: "var(--color-bg-card)",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "var(--radius-card)",
              boxShadow: "var(--shadow-md)",
              zIndex: 200,
              padding: "4px 0",
              overflow: "hidden",
            }}>
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
