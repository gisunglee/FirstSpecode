"use client";

/**
 * LNB — 좌측 사이드바 내비게이션 (AR-00095)
 *
 * 역할:
 *   - NAVIGATION / SYSTEM 두 섹션으로 메뉴 구성
 *   - 현재 pathname 기반 active 메뉴 표시 (FID-00204)
 *   - 토글 버튼으로 접힘/펼침 (sidebarCollapsed 전역 상태)
 *   - 접힌 상태에서 아이콘 hover 시 툴팁 표시 (components.css)
 *   - 역할별 메뉴 필터링 (UW-00011):
 *       OWNER/ADMIN → 멤버 관리 + 프로젝트 설정 모두 노출
 *       PM/DESIGNER/DEVELOPER → 프로젝트 설정만 노출, 멤버 관리 숨김
 *       VIEWER → System 섹션 전체 숨김
 *
 * 주요 기술:
 *   - Next.js usePathname: active 메뉴 판별
 *   - Zustand: sidebarCollapsed, currentProjectId
 *   - useMyRole: 역할 기반 메뉴 제어
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppStore } from "@/store/appStore";
import { useMyRole } from "@/hooks/useMyRole";

// 메뉴 아이템 정의
type MenuItem = {
  label: string;
  href:  string;
  icon:  string; // 임시 이모지 아이콘 — lucide-react 도입 후 교체 예정
};

export default function LNB() {
  const pathname = usePathname();
  const { sidebarCollapsed, toggleSidebar, currentProjectId } = useAppStore();
  const { canManageMembers, canAccessSettings } = useMyRole(currentProjectId);

  // 프로젝트별 경로 — currentProjectId 없으면 "#"으로 비활성
  const pBase            = currentProjectId ? `/projects/${currentProjectId}` : null;
  const tasksHref        = pBase ? `${pBase}/tasks`         : "#";
  const requirementsHref = pBase ? `${pBase}/requirements`  : "#";
  const userStoriesHref  = pBase ? `${pBase}/user-stories`  : "#";
  const unitWorksHref    = pBase ? `${pBase}/unit-works`    : "#";
  const baselineHref     = pBase ? `${pBase}/baseline`      : "#";
  const screensHref      = pBase ? `${pBase}/screens`       : "#";
  const areasHref        = pBase ? `${pBase}/areas`         : "#";
  const functionsHref    = pBase ? `${pBase}/functions`     : "#";
  const dbTablesHref        = pBase ? `${pBase}/db-tables`        : "#";
  const designChangesHref   = pBase ? `${pBase}/design-changes`   : "#";
  const aiTasksHref         = pBase ? `${pBase}/ai-tasks`         : "#";
  const promptTemplatesHref = pBase ? `${pBase}/prompt-templates` : "#";
  const reviewsHref         = pBase ? `${pBase}/reviews`          : "#";
  const planningHref        = pBase ? `${pBase}/planning`           : "#";
  const aiImportHref        = pBase ? `${pBase}/planning/ai-import` : "#";
  const designImportHref    = pBase ? `${pBase}/design-import`      : "#";
  const settingsHref     = pBase ? `${pBase}/settings`      : "#";
  const membersHref      = pBase ? `${pBase}/members`       : "#";

  // NAVIGATION 섹션 — 대시보드·프로젝트 외 모든 항목은 프로젝트 스코프
  type NavItem = (MenuItem & { isActive: boolean }) | { isSeparator: true };
  const navItems: NavItem[] = [
    { label: "대시보드",    href: "/dashboard",    icon: "◉",  isActive: pathname.startsWith("/dashboard") },
    { label: "프로젝트",    href: "/projects",     icon: "📂", isActive: pathname === "/projects" },
    { label: "과업",         href: tasksHref,        icon: "📌", isActive: !!pBase && pathname.startsWith(`${pBase}/tasks`) },
    { label: "요구사항",    href: requirementsHref, icon: "📋", isActive: !!pBase && pathname.startsWith(`${pBase}/requirements`) },
    { label: "사용자스토리", href: userStoriesHref, icon: "📖", isActive: !!pBase && pathname.startsWith(`${pBase}/user-stories`) },
    { label: "기준선",       href: baselineHref,    icon: "🏁", isActive: !!pBase && pathname.startsWith(`${pBase}/baseline`) },
    { label: "요구분석 일괄 편집", href: planningHref, icon: "📅", isActive: !!pBase && pathname.startsWith(`${pBase}/planning`) && !pathname.startsWith(`${pBase}/planning/ai-import`) },
    { label: "기획 가져오기", href: aiImportHref, icon: "📥", isActive: !!pBase && pathname.startsWith(`${pBase}/planning/ai-import`) },
    { isSeparator: true },
    { label: "설계 가져오기", href: designImportHref, icon: "🏗",  isActive: !!pBase && pathname.startsWith(`${pBase}/design-import`) },
    { label: "단위업무",    href: unitWorksHref,    icon: "🧱", isActive: !!pBase && pathname.startsWith(`${pBase}/unit-works`) },
    { label: "화면 설계",   href: screensHref,      icon: "🖼",  isActive: !!pBase && pathname.startsWith(`${pBase}/screens`) },
    { label: "영역 관리",   href: areasHref,        icon: "📦", isActive: !!pBase && pathname.startsWith(`${pBase}/areas`) },
    { label: "기능 정의",   href: functionsHref,    icon: "⚙",  isActive: !!pBase && pathname.startsWith(`${pBase}/functions`) },
    { isSeparator: true },
    { label: "AI 태스크",    href: aiTasksHref,         icon: "✨", isActive: !!pBase && pathname.startsWith(`${pBase}/ai-tasks`) },
    { label: "프롬프트 관리", href: promptTemplatesHref, icon: "📝", isActive: !!pBase && pathname.startsWith(`${pBase}/prompt-templates`) },
    { label: "리뷰 요청",   href: reviewsHref,          icon: "💬", isActive: !!pBase && pathname.startsWith(`${pBase}/reviews`) },
    { label: "DB 테이블",   href: dbTablesHref,          icon: "🗄",  isActive: !!pBase && pathname.startsWith(`${pBase}/db-tables`) },
    { label: "설계 변경 이력", href: designChangesHref,   icon: "📜", isActive: !!pBase && pathname.startsWith(`${pBase}/design-changes`) },
  ];

  // SYSTEM 섹션 항목 — 역할에 따라 동적 구성
  const systemItems: (MenuItem & { isActive: boolean })[] = [
    ...(canAccessSettings && pBase
      ? [{ label: "프로젝트 설정", href: settingsHref, icon: "⚙️", isActive: pathname.startsWith(settingsHref) }]
      : []),
    ...(canManageMembers && pBase
      ? [{ label: "멤버 관리", href: membersHref, icon: "👥", isActive: pathname.startsWith(membersHref) }]
      : []),
    { label: "개인 설정", href: "/settings/profile", icon: "👤", isActive: pathname.startsWith("/settings/profile") },
  ];

  return (
    // 토글 버튼이 nav 바깥으로 삐져나오므로 overflow-x: hidden 없는 wrapper로 감쌈
    // nav에 overflow-x: hidden이 있으면 right: -13px 위치의 버튼이 잘림
    <div className={`sp-sidebar-wrapper${sidebarCollapsed ? " is-collapsed" : ""}`}>
      {/* 접힘/펼침 토글 버튼 — nav 바깥(wrapper 기준)에 위치해야 잘리지 않음 */}
      <button
        className="sp-sidebar-toggle"
        onClick={toggleSidebar}
        title={sidebarCollapsed ? "사이드바 펼치기" : "사이드바 접기"}
      >
        {/* 화살표 SVG — CSS에서 is-collapsed 시 180도 회전 */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>

      <nav className={`sp-sidebar${sidebarCollapsed ? " is-collapsed" : ""}`}>
        {/* NAVIGATION 섹션 */}
        <div className="sp-sidebar-section">
          <div className="sp-sidebar-title">Navigation</div>
          {navItems.map((item, idx) => {
            if ("isSeparator" in item) {
              return <div key={`sep-${idx}`} style={{ height: 1, background: "var(--color-border)", margin: "8px 24px", opacity: 0.5 }} />;
            }
            return <SidebarLink key={item.label} item={item} isActive={item.isActive} />;
          })}
        </div>

        {/* SYSTEM 섹션 — 역할 기반 필터링 적용 (UW-00011) */}
        <div className="sp-sidebar-section">
          <div className="sp-sidebar-title">System</div>
          {systemItems.map((item) => (
            <SidebarLink key={item.label} item={item} isActive={item.isActive} />
          ))}
        </div>
      </nav>
    </div>
  );
}

// ── SidebarLink 분리 — 같은 패턴이 2곳 이상이므로 컴포넌트 추출
function SidebarLink({
  item,
  isActive,
}: {
  item:     MenuItem;
  isActive: boolean;
}) {
  // href="#" 인 항목은 프로젝트 미선택 상태 → 클릭 시 이동 차단
  const isDisabled = item.href === "#";

  return (
    <Link
      href={item.href}
      className={`sp-sidebar-item${isActive ? " is-active" : ""}${isDisabled ? " is-disabled" : ""}`}
      data-label={item.label} // 접힌 상태에서 CSS tooltip에 사용
      onClick={isDisabled ? (e) => e.preventDefault() : undefined}
      style={isDisabled ? { opacity: 0.4, cursor: "not-allowed", pointerEvents: "none" } : undefined}
    >
      {/* 아이콘 — SVG 자리에 이모지 임시 사용 */}
      <svg viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
        <text y="18" fontSize="14" fill="currentColor">{item.icon}</text>
      </svg>
      <span>{item.label}</span>
    </Link>
  );
}
