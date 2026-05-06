"use client";

/**
 * AdminLayout — 시스템 관리자 전용 라우트 가드 + 공통 프레임
 *
 * 역할:
 *   - /admin/** 진입 시 isSystemAdmin 체크, 아니면 대시보드로 리디렉션
 *   - 상단 탭 네비(사용자/프로젝트/감사 로그) 공통 노출
 *   - 프로필 로딩 중에는 조용히 스피너만 표시 (UI 깜빡임 방지)
 *
 * 설계:
 *   - 서버 렌더링으로 막지 않는 이유:
 *     (main) 레이아웃이 이미 클라이언트 컴포넌트 기반 인증 흐름이라
 *     layout.tsx 를 서버로 만들면 세션 토큰 전달이 꼬임.
 *     → 클라이언트에서 profile 쿼리 → isSystemAdmin=false 면 즉시 push
 *   - API 는 독립적으로 requireSystemAdmin() 으로 보호되므로 UI 가드가
 *     뚫려도 데이터는 노출되지 않음 (이중 방어선)
 */

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useIsSystemAdmin } from "@/hooks/useMyRole";

type TabDef = { label: string; href: string };

const TABS: TabDef[] = [
  { label: "대시보드",        href: "/admin" },
  { label: "사용자",          href: "/admin/users" },
  { label: "프로젝트",        href: "/admin/projects" },
  { label: "환경설정 템플릿", href: "/admin/config-templates" },
  { label: "설계 양식",       href: "/admin/design-templates" },
  { label: "프롬프트 관리",   href: "/admin/prompt-templates" },
  { label: "감사 로그",       href: "/admin/audit" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isSystemAdmin, isLoading } = useIsSystemAdmin();
  const router   = useRouter();
  const pathname = usePathname();

  // 로딩 완료 + 관리자 아님 → 대시보드로 우회
  // (404 대신 리디렉트 — 주소표시줄에 /admin 이 남지 않도록)
  useEffect(() => {
    if (!isLoading && !isSystemAdmin) {
      router.replace("/dashboard");
    }
  }, [isLoading, isSystemAdmin, router]);

  // 로딩 중 또는 비관리자 → 빈 화면 (flash 방지)
  if (isLoading || !isSystemAdmin) {
    return (
      <div style={{ padding: 40, color: "var(--color-text-tertiary)", fontSize: "var(--text-sm)" }}>
        권한 확인 중…
      </div>
    );
  }

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1400, margin: "0 auto" }}>
      {/* 상단 헤더 — 시스템 관리 영역임을 명확히 표시 */}
      <div
        style={{
          display:      "flex",
          alignItems:   "center",
          gap:          12,
          marginBottom: 16,
        }}
      >
        <span
          style={{
            display:      "inline-flex",
            alignItems:   "center",
            gap:          6,
            padding:      "3px 10px",
            fontSize:     "var(--text-xs)",
            fontWeight:   700,
            background:   "var(--color-warning-subtle)",
            color:        "var(--color-warning)",
            border:       "1px solid var(--color-warning-border)",
            borderRadius: "var(--radius-sm)",
            letterSpacing:"0.04em",
          }}
        >
          SYSTEM ADMIN
        </span>
        <h1 style={{ margin: 0, fontSize: "var(--text-xl)", color: "var(--color-text-heading)" }}>
          시스템 관리
        </h1>
      </div>

      {/* 탭 네비게이션 */}
      <nav
        style={{
          display:     "flex",
          gap:         4,
          borderBottom:"1px solid var(--color-border)",
          marginBottom:20,
        }}
      >
        {TABS.map((t) => {
          // 정확 일치 또는 서브 경로 — "/admin" 은 서브 경로 매칭 제외 (대시보드 전용)
          const isActive =
            t.href === "/admin"
              ? pathname === "/admin"
              : pathname === t.href || pathname.startsWith(t.href + "/");
          return (
            <Link
              key={t.href}
              href={t.href}
              style={{
                padding:        "8px 16px",
                fontSize:       "var(--text-md)",
                fontWeight:     isActive ? 600 : 400,
                color:          isActive ? "var(--color-brand)" : "var(--color-text-secondary)",
                borderBottom:   isActive ? "2px solid var(--color-brand)" : "2px solid transparent",
                textDecoration: "none",
                marginBottom:   -1, // border 와 겹치게
              }}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
