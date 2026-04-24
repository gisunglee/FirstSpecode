"use client";

/**
 * LNB — 좌측 사이드바 (2-Pane: 아이콘 레일 + 서브 패널)
 *
 * 역할:
 *   - 좌측 좁은 레일에 그룹 아이콘을 세로로 나열
 *   - 레일 아이콘 클릭 시 우측 서브 패널이 그 그룹의 메뉴로 즉시 교체
 *   - 현재 URL 경로 → 자동으로 활성 그룹 판별 (예: /functions → "설계" 그룹)
 *   - 사용자가 수동으로 다른 그룹을 펼친 경우, 마지막 선택을 sessionStorage에 보관
 *     → URL이 그 그룹 안에 머물러 있는 동안에는 사용자 선택 유지
 *     → URL이 다른 그룹으로 넘어가면 자동으로 그쪽 그룹 활성화
 *   - 사이드바 접힘(sidebarCollapsed): 서브 패널만 숨김, 레일은 항상 노출
 *   - 역할 기반 메뉴 필터:
 *       OWNER/ADMIN → 멤버 관리 + 프로젝트 설정 모두 노출
 *       PM/DESIGNER/DEVELOPER → 프로젝트 설정만 노출, 멤버 관리 숨김
 *       VIEWER → 설정/환경설정/멤버 관리 모두 숨김
 *
 * 디자인:
 *   - 모든 아이콘은 menuIcons.tsx 의 모노크롬 SVG (currentColor 상속)
 *   - 텍스트 크기: 그룹 타이틀 14px, 항목 13px, 레일 라벨 10px
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { useMyRole, useIsSystemAdmin } from "@/hooks/useMyRole";
import { MenuIcon, type MenuIconKey } from "./menuIcons";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type MenuItem = {
  label: string;
  href: string;
  icon: MenuIconKey;
  // 상위 항목의 하위로 보이도록 살짝 들여쓰는 표시 (ex: 영역은 화면의 세부 구성)
  // 혼동 쌍(화면↔영역)에만 제한적으로 사용. 전체 계층 트리화는 과하므로 의도적 최소 개입
  indent?: boolean;
};

type MenuGroup = {
  key: string;          // sessionStorage / 활성 판별용 고유키
  label: string;        // 서브 패널 상단 타이틀
  icon: MenuIconKey;    // 레일 아이콘
  items: MenuItem[];
  // accent=true 면 레일 아이콘·라벨을 warning 톤으로 강조.
  // "시스템 관리"처럼 일반 업무 흐름과 구분해야 하는 그룹 전용.
  accent?: boolean;
};

// ── 활성 그룹 sessionStorage 키 ──────────────────────────────────────────────
const STORAGE_KEY = "specode-lnb-active-group";

export default function LNB() {
  const pathname = usePathname();
  const { sidebarCollapsed, toggleSidebar, setSidebarCollapsed, currentProjectId } = useAppStore();
  const { canManageMembers, canAccessSettings } = useMyRole(currentProjectId);
  // SUPER_ADMIN 여부 — "시스템 관리" 그룹 노출 판정에 사용
  const { isSystemAdmin } = useIsSystemAdmin();

  // 프로젝트 베이스 경로 — 미선택 시 null → 해당 메뉴들은 비활성 처리
  const pBase = currentProjectId ? `/projects/${currentProjectId}` : null;

  // ── 메뉴 그룹 정의 ─────────────────────────────────────────────────────────
  // useMemo: pathname/role 의존이 아니므로 pBase 변경 시에만 재계산
  const groups = useMemo<MenuGroup[]>(() => {
    // 프로젝트 미선택 시에도 보이는 항목 (대시보드/프로젝트 목록/개인 설정)
    // 그 외는 pBase 가 있을 때만 href 생성, 없으면 "#" 으로 비활성
    const p = (sub: string) => (pBase ? `${pBase}${sub}` : "#");

    const list: MenuGroup[] = [
      {
        key: "dashboard",
        label: "대시보드",
        icon: "g_dashboard",
        items: [
          { label: "대시보드", href: "/dashboard", icon: "i_dashboard" },
        ],
      },
      {
        key: "project",
        label: "프로젝트",
        icon: "g_project",
        // 라벨은 그룹 이름("프로젝트")과 중복되는 접두사를 뗌 — "프로젝트 목록" → "목록"
        // "개인 설정" / "MCP 키" 는 GNB 우상단 아바타 드롭다운에서 진입 → LNB 에서는 제거
        // "환경설정" 은 도구 메타 설정 성격이라 "스펙설정" 그룹으로 이동
        items: [
          { label: "목록", href: "/projects", icon: "i_projectList" },
          ...(canAccessSettings && pBase
            ? [{ label: "설정", href: p("/settings"), icon: "i_projectSettings" as MenuIconKey }]
            : []),
          ...(canManageMembers && pBase
            ? [{ label: "멤버", href: p("/members"), icon: "i_members" as MenuIconKey }]
            : []),
        ],
      },
      {
        key: "analysis",
        label: "분석",
        icon: "g_analysis",
        items: [
          { label: "과업",              href: p("/tasks"),         icon: "i_task" },
          { label: "요구사항",          href: p("/requirements"),  icon: "i_requirement" },
          { label: "사용자스토리",      href: p("/user-stories"),  icon: "i_userStory" },
          { label: "요구사항 확정",     href: p("/baseline"),      icon: "i_baseline" },
          { label: "요구분석 일괄 편집", href: p("/planning"),     icon: "i_planningBatch" },
          { label: "기획실",            href: p("/plan-studio"),   icon: "i_planStudio" },
        ],
      },
      {
        key: "design",
        label: "설계",
        icon: "g_design",
        // 라벨은 그룹 이름("설계")과 중복되는 접미사를 뗌 — "화면설계" → "화면"
        // "영역"은 화면의 세부 구성이라는 힌트를 주기 위해 살짝 들여씀 (indent: true)
        items: [
          { label: "단위업무",  href: p("/unit-works"), icon: "i_unitWork" },
          { label: "화면",      href: p("/screens"),    icon: "i_screen" },
          { label: "영역",      href: p("/areas"),      icon: "i_area", indent: true },
          { label: "기능",      href: p("/functions"),  icon: "i_function" },
          { label: "DB 테이블", href: p("/db-tables"),  icon: "i_dbTable" },
        ],
      },
      {
        key: "common",
        label: "공통 설계",
        icon: "g_common",
        // A군: 프로젝트 콘텐츠 자체(내가 만들 시스템의 재료)
        items: [
          { label: "표준 가이드", href: p("/standard-guides"), icon: "i_standardGuide" },
          { label: "공통코드",    href: p("/common-codes"),    icon: "i_commonCode" },
          { label: "기준 정보",   href: p("/reference-info"),  icon: "i_referenceInfo" },
        ],
      },
      {
        key: "ai",
        label: "AI 작업실",
        icon: "g_ai",
        items: [
          { label: "AI 태스크",     href: p("/ai-tasks"),           icon: "i_aiTask" },
          { label: "기획 가져오기", href: p("/planning/ai-import"), icon: "i_planImport" },
          { label: "설계 가져오기", href: p("/design-import"),      icon: "i_designImport" },
        ],
      },
      {
        key: "spec_config",
        label: "스펙설정",
        icon: "g_spec_config",
        // 프로젝트 단위 도구 메타 설정.
        items: [
          { label: "설계 양식",     href: p("/design-templates"), icon: "i_designTemplate" },
          { label: "프롬프트 관리", href: p("/prompt-templates"), icon: "i_promptTemplate" },
          ...(canAccessSettings && pBase
            ? [{ label: "환경설정", href: p("/configs"), icon: "i_envSettings" as MenuIconKey }]
            : []),
        ],
      },
      {
        key: "help",
        label: "도움창고",
        icon: "g_help",
        items: [
          { label: "리뷰 요청", href: p("/reviews"), icon: "i_review" },
          { label: "메모",      href: p("/memos"),   icon: "i_memo" },
        ],
      },
      {
        key: "data",
        label: "데이터 조회",
        icon: "g_data",
        items: [
          { label: "그래프 뷰",        href: p("/graph"),          icon: "i_graph" },
          { label: "설계 변경 이력",   href: p("/design-changes"), icon: "i_changeLog" },
          { label: "Diff 테스트",      href: "/test/diff-prompt",  icon: "i_diffTest" },
        ],
      },
      // 시스템 관리 — SUPER_ADMIN 만 노출. 프로젝트 문맥과 무관하므로 pBase 불필요.
      // accent=true 로 레일 아이콘이 warning 톤으로 살짝 튀게 표시된다.
      ...(isSystemAdmin
        ? [{
            key:   "admin",
            label: "시스템 관리",
            icon:  "g_admin" as MenuIconKey,
            accent: true,
            items: [
              { label: "대시보드",        href: "/admin",                   icon: "i_dashboard" as MenuIconKey },
              { label: "사용자",          href: "/admin/users",             icon: "i_members" as MenuIconKey },
              { label: "프로젝트",        href: "/admin/projects",          icon: "i_projectList" as MenuIconKey },
              { label: "환경설정 템플릿", href: "/admin/config-templates",  icon: "i_envSettings" as MenuIconKey },
              { label: "감사 로그",       href: "/admin/audit",             icon: "i_changeLog" as MenuIconKey },
            ],
          }]
        : []),
    ];

    // 빈 그룹은 표시하지 않음 (예: VIEWER는 프로젝트 그룹의 항목 일부만 남거나 비어있을 수 있음)
    return list.filter((g) => g.items.length > 0);
  }, [pBase, canAccessSettings, canManageMembers, isSystemAdmin]);

  // ── URL 기반 자동 활성 그룹/항목 판별 ─────────────────────────────────────
  // 한 번에 가장 긴 prefix 일치 항목을 찾아 그룹키와 href 를 동시에 산출.
  //
  // "가장 긴 prefix 가 이긴다" 규칙이 필요한 이유:
  //   - "/projects" 와 "/projects/:id/members" 처럼 prefix 관계인 메뉴가 함께 있을 때
  //     단순 startsWith 만으로 판정하면 두 항목이 동시에 활성화됨 (목록+멤버)
  //   - 가장 긴 일치 하나만 활성으로 인정해 중복 활성을 막음
  //
  // 그룹 자동 매칭에도 같은 결과를 사용 — 한 번 순회로 둘 다 결정
  const { groupByUrl, activeItemHref } = useMemo<{
    groupByUrl: string | null;
    activeItemHref: string | null;
  }>(() => {
    let bestGroupKey: string | null = null;
    let bestHref:     string | null = null;
    let bestLen      = 0;
    for (const g of groups) {
      for (const it of g.items) {
        if (it.href === "#") continue;
        // 정확 일치 또는 prefix + "/" 로 시작
        const matches =
          pathname === it.href || pathname.startsWith(it.href + "/");
        if (matches && it.href.length > bestLen) {
          bestGroupKey = g.key;
          bestHref     = it.href;
          bestLen      = it.href.length;
        }
      }
    }
    return { groupByUrl: bestGroupKey, activeItemHref: bestHref };
  }, [pathname, groups]);

  // ── 활성 그룹 상태 ─────────────────────────────────────────────────────────
  // 우선순위: URL이 어떤 그룹에 매칭되면 → 그 그룹
  //          매칭되지 않으면 → sessionStorage에 마지막으로 선택한 그룹
  //          그것도 없으면 → 첫 그룹 (dashboard)
  const [activeKey, setActiveKey] = useState<string>(() => {
    if (typeof window === "undefined") return "dashboard";
    const saved = sessionStorage.getItem(STORAGE_KEY);
    return saved || "dashboard";
  });

  // URL이 바뀌어 자동 매칭된 그룹이 있다면 그것을 활성으로 동기화
  useEffect(() => {
    if (groupByUrl && groupByUrl !== activeKey) {
      setActiveKey(groupByUrl);
    }
    // groupByUrl 만 의존 — activeKey 변동에 의해 다시 트리거되지 않도록 함
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupByUrl]);

  // 사용자가 수동으로 그룹을 바꿀 때만 호출 — sessionStorage에 영속화
  function selectGroup(key: string) {
    setActiveKey(key);
    if (typeof window !== "undefined") {
      sessionStorage.setItem(STORAGE_KEY, key);
    }
    // 사이드바가 접혀 있으면 자동으로 펼쳐 서브 패널을 드러냄.
    // 레일 아이콘만 보이던 상태에서 클릭 의도는 "해당 그룹 메뉴 열기"이므로
    // 한 번 더 토글 버튼을 누르게 하는 것은 불필요한 단계.
    if (sidebarCollapsed) setSidebarCollapsed(false);
  }

  // 현재 활성 그룹 객체 — activeKey가 사라진 그룹을 가리키면 첫 그룹 사용
  const activeGroup = groups.find((g) => g.key === activeKey) ?? groups[0];

  return (
    <div className={`sp-sidebar-wrapper${sidebarCollapsed ? " is-collapsed" : ""}`}>
      {/* 접힘/펼침 토글 — 서브 패널의 우측 가장자리에 위치
          collapsed 상태에서는 토글이 레일 우측 끝에 위치 (CSS에서 처리) */}
      <button
        className="sp-sidebar-toggle"
        onClick={toggleSidebar}
        title={sidebarCollapsed ? "사이드바 펼치기" : "사이드바 접기"}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>

      {/* ── 좌측 레일: 그룹 아이콘 ─────────────────────────────────────────── */}
      <nav className="sp-rail" aria-label="그룹 메뉴">
        {groups.map((g) => {
          const isActive = g.key === activeKey;
          // accent 그룹("시스템 관리")은 warning 톤으로 강조.
          // 인라인 style 오버라이드 — 기본 CSS 클래스(is-active) 에서 오는 색을 덮어쓴다.
          const accentStyle: React.CSSProperties | undefined = g.accent
            ? {
                color: "var(--color-warning)",
                ...(isActive ? { background: "var(--color-warning-subtle)" } : {}),
              }
            : undefined;
          return (
            <button
              key={g.key}
              className={`sp-rail-item${isActive ? " is-active" : ""}`}
              onClick={() => selectGroup(g.key)}
              title={g.label}
              style={accentStyle}
            >
              <MenuIcon name={g.icon} size={20} />
              <span className="sp-rail-label">{g.label}</span>
            </button>
          );
        })}
      </nav>

      {/* ── 우측 서브 패널: 활성 그룹의 메뉴 목록 ──────────────────────────── */}
      {!sidebarCollapsed && activeGroup && (
        <nav className="sp-subpane" aria-label={`${activeGroup.label} 메뉴`}>
          <div
            className="sp-subpane-title"
            // accent 그룹은 타이틀 색을 warning 으로 바꿔 "관리자 모드" 라는 점을 상시 인지시킨다
            style={activeGroup.accent ? { color: "var(--color-warning)" } : undefined}
          >
            {activeGroup.label}
            {activeGroup.accent && (
              <span style={{
                marginLeft: 8,
                fontSize:   "var(--text-xs)",
                fontWeight: 700,
                padding:    "1px 6px",
                borderRadius: 3,
                background: "var(--color-warning-subtle)",
                color:      "var(--color-warning)",
                border:     "1px solid var(--color-warning-border)",
                letterSpacing: "0.04em",
                verticalAlign: "middle",
              }}>
                ADMIN
              </span>
            )}
          </div>
          <div className="sp-subpane-items">
            {activeGroup.items.map((it) => (
              <SubItem
                key={it.label}
                item={it}
                // "가장 긴 일치" 한 항목만 활성. prefix 충돌(예: /projects 와
                // /projects/:id/members) 시 더 긴 쪽만 활성으로 인정하여
                // "목록+멤버" 동시 active 문제를 방지.
                isActive={it.href !== "#" && it.href === activeItemHref}
              />
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}

// ── 서브 패널 항목 (Link) ─────────────────────────────────────────────────────
function SubItem({ item, isActive }: { item: MenuItem; isActive: boolean }) {
  const isDisabled = item.href === "#";
  return (
    <Link
      href={item.href}
      className={`sp-subpane-item${isActive ? " is-active" : ""}${isDisabled ? " is-disabled" : ""}${item.indent ? " is-indented" : ""}`}
      onClick={isDisabled ? (e) => e.preventDefault() : undefined}
    >
      <MenuIcon name={item.icon} size={15} />
      <span>{item.label}</span>
    </Link>
  );
}
