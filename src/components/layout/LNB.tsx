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
  href: string;
  icon: string; // 임시 이모지 아이콘 — lucide-react 도입 후 교체 예정
};

export default function LNB() {
  const pathname = usePathname();
  const { sidebarCollapsed, toggleSidebar, currentProjectId } = useAppStore();
  const { canManageMembers, canAccessSettings } = useMyRole(currentProjectId);

  // 프로젝트별 경로 — currentProjectId 없으면 "#"으로 비활성
  const pBase = currentProjectId ? `/projects/${currentProjectId}` : null;
  const tasksHref = pBase ? `${pBase}/tasks` : "#";
  const requirementsHref = pBase ? `${pBase}/requirements` : "#";
  const userStoriesHref = pBase ? `${pBase}/user-stories` : "#";
  const unitWorksHref = pBase ? `${pBase}/unit-works` : "#";
  const baselineHref = pBase ? `${pBase}/baseline` : "#";
  const screensHref = pBase ? `${pBase}/screens` : "#";
  const areasHref = pBase ? `${pBase}/areas` : "#";
  const functionsHref = pBase ? `${pBase}/functions` : "#";
  const planStudioHref = pBase ? `${pBase}/plan-studio` : "#";
  const dbTablesHref = pBase ? `${pBase}/db-tables` : "#";
  const designChangesHref = pBase ? `${pBase}/design-changes` : "#";
  const referenceInfoHref = pBase ? `${pBase}/reference-info` : "#";
  const aiTasksHref = pBase ? `${pBase}/ai-tasks` : "#";
  const promptTemplatesHref = pBase ? `${pBase}/prompt-templates` : "#";
  const reviewsHref = pBase ? `${pBase}/reviews` : "#";
  const memosHref = pBase ? `${pBase}/memos` : "#";
  const planningHref = pBase ? `${pBase}/planning` : "#";
  const aiImportHref = pBase ? `${pBase}/planning/ai-import` : "#";
  const designImportHref = pBase ? `${pBase}/design-import` : "#";
  const graphViewHref = pBase ? `${pBase}/graph` : "#";
  const commonCodesHref = pBase ? `${pBase}/common-codes` : "#";
  const configsHref = pBase ? `${pBase}/configs` : "#";
  const settingsHref = pBase ? `${pBase}/settings` : "#";
  const membersHref = pBase ? `${pBase}/members` : "#";

  // ── 메뉴 그룹 구조 ───────────────────────────────────────────────────────
  // 대시보드는 최상단 단독, 이후 분석 / 설계 / 기타 설계 / AI 작업실 / 도움창고 / 프로젝트 / 환경설정
  type GroupItem = MenuItem & { isActive: boolean };
  type MenuGroup = { title: string; items: GroupItem[] };

  // 분석
  const analysisGroup: MenuGroup = {
    title: "분석",
    items: [
      { label: "과업", href: tasksHref, icon: "📌", isActive: !!pBase && pathname.startsWith(`${pBase}/tasks`) },
      { label: "요구사항", href: requirementsHref, icon: "📋", isActive: !!pBase && pathname.startsWith(`${pBase}/requirements`) },
      { label: "사용자스토리", href: userStoriesHref, icon: "📖", isActive: !!pBase && pathname.startsWith(`${pBase}/user-stories`) },
      { label: "요구사항 확정", href: baselineHref, icon: "🏁", isActive: !!pBase && pathname.startsWith(`${pBase}/baseline`) },
    ],
  };

  // 설계
  const designGroup: MenuGroup = {
    title: "설계",
    items: [
      { label: "단위업무", href: unitWorksHref, icon: "🧱", isActive: !!pBase && pathname.startsWith(`${pBase}/unit-works`) },
      { label: "화면설계", href: screensHref, icon: "🖼", isActive: !!pBase && pathname.startsWith(`${pBase}/screens`) },
      { label: "영역설계", href: areasHref, icon: "📦", isActive: !!pBase && pathname.startsWith(`${pBase}/areas`) },
      { label: "기능설계", href: functionsHref, icon: "⚙", isActive: !!pBase && pathname.startsWith(`${pBase}/functions`) },
      { label: "DB 테이블", href: dbTablesHref, icon: "🗄", isActive: !!pBase && pathname.startsWith(`${pBase}/db-tables`) },
    ],
  };

  // 기타 설계
  const extraDesignGroup: MenuGroup = {
    title: "기타 설계",
    items: [
      ...(pBase ? [{ label: "공통코드", href: commonCodesHref, icon: "🏷", isActive: pathname.startsWith(commonCodesHref) }] : []),
      ...(pBase ? [{ label: "기준 정보", href: referenceInfoHref, icon: "📑", isActive: pathname.startsWith(referenceInfoHref) }] : []),
    ],
  };

  // AI 작업실
  const aiStudioGroup: MenuGroup = {
    title: "AI 작업실",
    items: [
      { label: "AI 태스크", href: aiTasksHref, icon: "✨", isActive: !!pBase && pathname.startsWith(`${pBase}/ai-tasks`) },
      { label: "프롬프트 관리", href: promptTemplatesHref, icon: "📝", isActive: !!pBase && pathname.startsWith(`${pBase}/prompt-templates`) },
      { label: "기획 가져오기", href: aiImportHref, icon: "📥", isActive: !!pBase && pathname.startsWith(`${pBase}/planning/ai-import`) },
      { label: "설계 가져오기", href: designImportHref, icon: "🏗", isActive: !!pBase && pathname.startsWith(`${pBase}/design-import`) },
    ],
  };

  // 도움창고
  const helperGroup: MenuGroup = {
    title: "도움창고",
    items: [
      { label: "요구분석 일괄 편집", href: planningHref, icon: "📅", isActive: !!pBase && pathname.startsWith(`${pBase}/planning`) && !pathname.startsWith(`${pBase}/planning/ai-import`) },
      { label: "기획실", href: planStudioHref, icon: "🎨", isActive: !!pBase && pathname.startsWith(`${pBase}/plan-studio`) },
      { label: "리뷰 요청", href: reviewsHref, icon: "💬", isActive: !!pBase && pathname.startsWith(`${pBase}/reviews`) },
      { label: "메모", href: memosHref, icon: "🗒", isActive: !!pBase && pathname.startsWith(`${pBase}/memos`) },
      // 실험: 프로젝트 계층을 그래프로 시각화 (UX 테스트 중)
      { label: "그래프 뷰 ✨", href: graphViewHref, icon: "🕸", isActive: !!pBase && pathname.startsWith(`${pBase}/graph`) },
    ],
  };

  // 데이터 조회
  const dataViewGroup: MenuGroup = {
    title: "데이터 조회",
    items: [
      { label: "설계 변경 이력", href: designChangesHref, icon: "📜", isActive: !!pBase && pathname.startsWith(`${pBase}/design-changes`) },
    ],
  };

  // 프로젝트
  const projectGroup: MenuGroup = {
    title: "프로젝트",
    items: [
      { label: "프로젝트", href: "/projects", icon: "📂", isActive: pathname === "/projects" },
      ...(canAccessSettings && pBase ? [{ label: "프로젝트 설정", href: settingsHref, icon: "⚙️", isActive: pathname.startsWith(settingsHref) }] : []),
      ...(canManageMembers && pBase ? [{ label: "멤버 관리", href: membersHref, icon: "👥", isActive: pathname.startsWith(membersHref) }] : []),
      { label: "개인 설정", href: "/settings/profile", icon: "👤", isActive: pathname.startsWith("/settings/profile") },
    ],
  };

  // 환경설정
  const configGroup: MenuGroup = {
    title: "환경설정",
    items: [
      ...(canAccessSettings && pBase ? [{ label: "환경설정", href: configsHref, icon: "🔧", isActive: pathname.startsWith(configsHref) }] : []),
    ],
  };

  // 빈 그룹은 표시하지 않음 (환경설정 → 데이터 조회 순서)
  const menuGroups: MenuGroup[] = [
    analysisGroup, designGroup, extraDesignGroup, aiStudioGroup, helperGroup, projectGroup, configGroup, dataViewGroup,
  ].filter((g) => g.items.length > 0);

  // 대시보드 (최상단 단독)
  const dashboardItem: GroupItem = {
    label: "대시보드", href: "/dashboard", icon: "◉", isActive: pathname.startsWith("/dashboard"),
  };

  // 테스트 메뉴 (하단 별도)
  const testItem: GroupItem = {
    label: "Diff 테스트", href: "/test/diff-prompt", icon: "🧪", isActive: pathname.startsWith("/test/diff-prompt"),
  };

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
        {/* 대시보드 — 그룹 외 최상단 단독 */}
        <div className="sp-sidebar-section">
          <SidebarLink item={dashboardItem} isActive={dashboardItem.isActive} />
        </div>

        {/* 그룹별 메뉴 */}
        {menuGroups.map((group) => (
          <div key={group.title} className="sp-sidebar-section">
            <div className="sp-sidebar-title">{group.title}</div>
            {group.items.map((item) => (
              <SidebarLink key={item.label} item={item} isActive={item.isActive} />
            ))}
          </div>
        ))}

        {/* 테스트 메뉴 — 프로젝트 무관 */}
        <div className="sp-sidebar-section">
          <SidebarLink item={testItem} isActive={testItem.isActive} />
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
  item: MenuItem;
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
      {/* 아이콘 — SVG 자리에 이모지 임시 사용 (textAnchor로 가로 중앙 정렬) */}
      <svg viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
        <text x="12" y="18" fontSize="14" fill="currentColor" textAnchor="middle">{item.icon}</text>
      </svg>
      <span>{item.label}</span>
    </Link>
  );
}
