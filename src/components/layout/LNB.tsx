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
import { usePathname, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { useMyRole, useIsSystemAdmin } from "@/hooks/useMyRole";
import { getHomePageCookie, setHomePageCookie, clearHomePageCookie } from "@/lib/homePage";
import { MenuIcon, type MenuIconKey } from "./menuIcons";
import MemoEntryButton from "@/components/common/MemoEntryButton";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type MenuItem = {
  label: string;
  href: string;
  icon: MenuIconKey;
  // 상위 항목의 하위로 보이도록 살짝 들여쓰는 표시 (ex: 영역은 화면의 세부 구성)
  // 혼동 쌍(화면↔영역)에만 제한적으로 사용. 전체 계층 트리화는 과하므로 의도적 최소 개입
  indent?: boolean;
  // true면 행 우측에 별 아이콘(홈페이지 지정 토글) 노출 — 로그인 직후 착지 페이지로 고를 만한
  // 개인 업무 화면(대시보드 그룹 5개 + 일정 그룹의 캘린더)에 부여한다. 그룹 소속과는 무관.
  // 2026-07-22: 로그인 직후 착지 페이지를 사용자가 고를 수 있게 추가.
  canPinHome?: boolean;
  // true면 이 항목 바로 아래에 구분선 표시 — 성격이 다른 항목 묶음을 시각적으로 분리
  // (예: 분석 그룹의 "과업·요구사항"과 그 아래 나머지 항목, 2026-07-29)
  dividerAfter?: boolean;
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
  const pathname     = usePathname();
  // 활성 메뉴 판별에 search params 도 사용 (예: ?kind=UNIT vs ?kind=INTEGRATION)
  // — 같은 path 두 메뉴를 정확히 구분하기 위함. 다른 메뉴는 href 에 쿼리가 없어 영향 없음.
  const searchParams = useSearchParams();
  const { sidebarCollapsed, toggleSidebar, setSidebarCollapsed, currentProjectId } = useAppStore();
  const { myRole, canManageMembers, canAccessSettings, canManageWeeklyReport, isLoading: isRoleLoading } = useMyRole(currentProjectId);
  // SUPER_ADMIN 여부 — "시스템 관리" 그룹 노출 판정에 사용
  const { isSystemAdmin } = useIsSystemAdmin();

  // 지원 세션 모드 — admin 이 본인 멤버 아닌 프로젝트의 컨텍스트에 있을 때.
  //   · SUPER_ADMIN + currentProjectId 있음 + 역할 조회 끝났는데 myRole 이 null
  // 이 모드에서는 "프로젝트 목록"(/projects = 본인 목록) 을 숨겨 컨텍스트 혼동 방지.
  const isSupportSession = isSystemAdmin && !!currentProjectId && !isRoleLoading && !myRole;

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
        // 신규 3종 대시보드는 모두 현재 프로젝트(currentProjectId) 컨텍스트에서 동작.
        // URL 은 프로젝트 prefix 없이 단일 경로로 유지 — 기존 /dashboard 와 동일한 패턴.
        // 순서(2026-07-22): 개인 업무 중심(대시보드/My Task/MY 보드) → PM 도구(PM 현황/PM 진단).
        // 캘린더는 2026-07-29 "일정" 그룹 맨 아래로 이동(일정 관련 메뉴끼리 묶는 게 자연스럽다는 피드백).
        // canPinHome: true — 이 5개만 별 아이콘으로 "내 홈페이지" 지정 가능(LNB 컴포넌트 본문 참조).
        items: [
          { label: "대시보드", href: "/dashboard", icon: "i_dashboard", canPinHome: true },
          { label: "My Task",  href: "/my-task",   icon: "i_myTask",   canPinHome: true },
          // 아래로 "PM 도구" 성격이 갈리는 지점이라 구분선(2026-07-29)
          { label: "MY 보드",  href: "/my-work",   icon: "i_mywork",   canPinHome: true, dividerAfter: true },
          { label: "PM 현황",  href: "/pm-board",  icon: "i_graph",    canPinHome: true },
          { label: "PM 진단",  href: "/pm",        icon: "i_pm",       canPinHome: true },
        ],
      },
      {
        key: "wbs",
        // 2026-07-20: "WBS" → "일정" — 업무일지/주간보고 추가로 그룹 성격이
        // "프로젝트 전체 간트" 에서 "일정 전반"(팀 일정 + 개인 계획/기록)으로 넓어짐.
        // key는 그대로 유지 — sessionStorage 활성 그룹 판별에 영향 없음.
        label: "일정",
        icon: "g_wbs",
        items: [
          // 단위업무/화면/기능 3종 간트 조회 — 영역(Area)은 날짜 컬럼이 없어 이번 범위 제외.
          { label: "WBS 일정", href: "/wbs", icon: "i_wbs" },
          // 캘린더 — 대시보드 그룹에서 이동(2026-07-29) — 일정 관련 메뉴끼리 묶는 게 자연스럽다는
          // 피드백. canPinHome 유지 — 이미 캘린더를 홈페이지로 지정해둔 사용자의 설정이 깨지지
          // 않도록. WBS/캘린더(팀 전체 일정 조회)와 아래 업무일지 이하(개인 계획/기록)는
          // 성격이 갈려서 구분선으로 나눔.
          { label: "캘린더", href: "/calendar", icon: "i_calendar", canPinHome: true, dividerAfter: true },
          // 업무일지 — 개인 오늘의 할일/기록. WBS와 동일하게 프로젝트 prefix 없는 flat 경로
          // (currentProjectId 는 페이지 내부에서 store 로 읽음 — pm/my-work/focus와 동일 패턴).
          { label: "업무일지", href: "/work-logs", icon: "i_myTask" },
          // 업무 리포트 — 업무일지와 완전히 같은 데이터를 "정돈된 문서" 형태로 보여주는
          // 개인용 대안 뷰(2026-07-20). 별도 권한 없음 — work-logs와 동일하게 전 직무 노출.
          // AI로 팀 전체를 모으는 기능은 여기 없음 — "내 문서"와 "팀 집계"가 한 화면에
          // 섞이면 헷갈린다는 피드백으로 "리더 리포트"로 분리했다(2026-07-21).
          { label: "업무 리포트", href: "/work-report", icon: "i_docs" },
          // 리더 리포트 — PM 전용. 팀원 전체 업무일지를 모은 AI 초안(금주실적/차주계획/총평)
          // + 참여 현황. weeklyReport.manage 없으면 메뉴 자체를 숨김(예전 "주간보고"와 동일 가드).
          ...(canManageWeeklyReport
            ? [{ label: "리더 리포트", href: "/leader-report", icon: "i_aiTask" as MenuIconKey }]
            : []),
        ],
      },
      {
        key: "project",
        label: "프로젝트",
        icon: "g_project",
        // 풀 라벨로 표기 — 그룹명("프로젝트")과 중복되더라도 의미가 명확해야 한다는 사용자 피드백 반영.
        // "개인 설정" / "MCP 키" 는 GNB 우상단 아바타 드롭다운에서 진입 → LNB 에서는 제거
        // "환경설정" 은 도구 메타 설정 성격이라 "스펙설정" 그룹으로 이동
        // "프로젝트 목록"(=본인 프로젝트) 은 지원 세션 모드일 때 숨김 (컨텍스트 혼동 방지).
        items: [
          ...(isSupportSession
            ? []
            : [{ label: "프로젝트 목록", href: "/projects", icon: "i_projectList" as MenuIconKey }]),
          ...(canAccessSettings && pBase
            ? [{ label: "프로젝트 설정", href: p("/settings"), icon: "i_projectSettings" as MenuIconKey }]
            : []),
          ...(canManageMembers && pBase
            ? [{ label: "프로젝트 멤버", href: p("/members"), icon: "i_members" as MenuIconKey }]
            : []),
        ],
      },
      {
        key: "analysis",
        label: "분석",
        icon: "g_analysis",
        items: [
          { label: "과업",              href: p("/tasks"),         icon: "i_task" },
          { label: "요구사항",          href: p("/requirements"),  icon: "i_requirement", dividerAfter: true },
          { label: "사용자스토리",      href: p("/user-stories"),  icon: "i_userStory" },
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
          { label: "기능",      href: p("/functions"),  icon: "i_function", dividerAfter: true },
          // DB 테이블은 화면/영역/기능 계층과 성격이 달라(설계 산출물 아님) 위로 구분(2026-07-29).
          // 공통코드·기준 정보는 "공통 설계" 그룹에서 이관(2026-08-28) — DB 테이블과 같은
          // "산출물이 참조하는 기준 데이터" 성격이라 바로 아래로 묶음.
          { label: "DB 테이블", href: p("/db-tables"),      icon: "i_dbTable" },
          { label: "공통코드",  href: p("/common-codes"),   icon: "i_commonCode" },
          { label: "기준 정보", href: p("/standard-info"),  icon: "i_referenceInfo", dividerAfter: true },
          // 표준 가이드는 성격이 또 달라(작성 규칙 문서) 별도 구분선 아래
          { label: "표준 가이드", href: p("/standard-guides"), icon: "i_standardGuide" },
        ],
      },
      {
        key: "test",
        label: "테스트",
        icon: "g_test",
        // 단위/통합 테스트 명세서 — 같은 목록 페이지를 kind 쿼리로 분기
        // (탭 1개 페이지로 두면 코드·진입 모두 단순. specId 라우트와 충돌 없음)
        items: [
          { label: "단위 테스트 명세서", href: p("/test-specs?kind=UNIT"),        icon: "i_testSpecUnit" },
          { label: "통합 테스트 명세서", href: p("/test-specs?kind=INTEGRATION"), icon: "i_testSpecIntegration" },
        ],
      },
      {
        key: "common",
        label: "공통 설계",
        icon: "g_common",
        // 2026-08-28: 하위 항목(표준 가이드/공통코드/기준 정보) 전부 "설계" 그룹으로 이관.
        // 메뉴 자체는 당장 그대로 유지 — 서브메뉴 없는 빈 상태 (의도적, 추후 재배치 검토용)
        items: [],
      },
      {
        key: "ai",
        label: "AI 작업실",
        icon: "g_ai",
        items: [
          { label: "AI 태스크",     href: p("/ai-tasks"),           icon: "i_aiTask" },
          { label: "스펙 동기화",   href: p("/spec-reconciliations"), icon: "i_changeLog" },
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
          // DOCS — 공식 문서. 프로젝트 무관 시스템 콘텐츠라 pBase 없이 고정 경로
          { label: "DOCS",      href: "/docs",                 icon: "i_docs" },
          // 문서실 — 요구사항 명세서·프로그램사양서 일람·일괄 다운로드 (프로젝트별)
          { label: "문서실",    href: p("/document-library"),  icon: "i_library" },
          { label: "리뷰 요청", href: p("/reviews"),           icon: "i_review" },
          // 메모/회의록은 같은 테이블(tb_ds_memo)을 구분(memo_purps_code)으로 필터링해
          // 진입하는 메뉴다 — 각자 자기 구분만 기본으로 보이도록 둘 다 purpose를 고정한다.
          // (목록 화면의 "구분" 필터 칩으로 언제든 "전체"로 바꿔 볼 수 있음)
          { label: "메모",      href: p("/memos?purpose=GENERAL"), icon: "i_memo" },
          { label: "회의록",    href: p("/memos?purpose=MEETING"), icon: "i_memo" },
        ],
      },
      {
        key: "data",
        label: "데이터 조회",
        icon: "g_data",
        items: [
          { label: "그래프 뷰",        href: p("/graph"),          icon: "i_graph" },
          { label: "설계 변경 이력",   href: p("/design-changes"), icon: "i_changeLog" },
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
              // DEFAULT 양식·프롬프트 — 모든 프로젝트의 AI 흐름에 영향 → SUPER_ADMIN 전용 페이지에서만 편집
              { label: "설계 양식",       href: "/admin/design-templates",  icon: "i_designTemplate" as MenuIconKey },
              { label: "프롬프트 관리",   href: "/admin/prompt-templates",  icon: "i_promptTemplate" as MenuIconKey },
              // 시스템 공식 문서(Docs Hub) 관리 — /docs 사용자 뷰어와 짝
              { label: "문서 관리",       href: "/admin/docs",              icon: "i_docs" as MenuIconKey },
              { label: "감사 로그",       href: "/admin/audit",             icon: "i_changeLog" as MenuIconKey },
              // 소프트삭제된 프로젝트의 영구 삭제 운영 화면
              { label: "정보 삭제",       href: "/admin/cleanup",           icon: "i_cleanup" as MenuIconKey },
            ],
          }]
        : []),
    ];

    // 빈 그룹은 표시하지 않음 (예: VIEWER는 프로젝트 그룹의 항목 일부만 남거나 비어있을 수 있음)
    return list.filter((g) => g.items.length > 0);
  }, [pBase, canAccessSettings, canManageMembers, isSystemAdmin, isSupportSession]);

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
    let bestScore    = -1;
    for (const g of groups) {
      for (const it of g.items) {
        if (it.href === "#") continue;
        // href 에서 path 와 query 분리 — query 가 있으면 정확 매칭 가중치 추가
        const [itPath, itQuery] = it.href.split("?");
        const pathMatches =
          pathname === itPath || pathname.startsWith(itPath + "/");
        if (!pathMatches) continue;

        // 점수 정책:
        //   path 만 매칭        → itPath.length * 10        (그룹 활성용 fallback)
        //   path + query 정확   → itPath.length * 10 + 1000 (확실한 항목 활성)
        //
        // query 가 있는 메뉴 (예: ?kind=UNIT|INTEGRATION) 가 path 만 매칭되는 경우,
        // 정확 매칭이 없으면 첫 메뉴가 그룹을 활성화시키는 fallback 역할.
        // 항목 강조(activeItemHref) 는 score 가장 높은 1개 — 정확 매칭이 우선.
        let score = itPath.length * 10;
        if (itQuery) {
          const itParams = new URLSearchParams(itQuery);
          let allMatch = true;
          for (const [k, v] of itParams) {
            if (searchParams.get(k) !== v) { allMatch = false; break; }
          }
          if (allMatch) score += 1000;
          // 불일치 시에도 path 매칭만으로 그룹은 통과 — 명세서 상세 같은 자식 경로에서 그룹 자동 활성용
        }
        if (score > bestScore) {
          bestGroupKey = g.key;
          bestHref     = it.href;
          bestScore    = score;
        }
      }
    }
    return { groupByUrl: bestGroupKey, activeItemHref: bestHref };
  }, [pathname, searchParams, groups]);

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

  // ── 내 홈페이지(로그인 직후 착지 페이지) ────────────────────────────────────
  // 쿠키 원천 — mount 시 1회 읽고, 별 아이콘 클릭 시에만 갱신(쿠키 자체는 반응형이
  // 아니라서 6개 행이 즉시 갱신되려면 이 state가 필요).
  const [homePage, setHomePageState] = useState<string | null>(null);
  useEffect(() => {
    setHomePageState(getHomePageCookie());
  }, []);

  function toggleHomePage(href: string) {
    if (homePage === href) {
      clearHomePageCookie();
      setHomePageState(null);
    } else {
      setHomePageCookie(href);
      setHomePageState(href);
    }
  }

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

        {/* 메모 — 사이드바 하단 고정 진입점(전역). 하단 상태바("설계 동기화 완료" 등)와
            성격이 달라(작업 상태 vs 자유 메모) 레일 쪽에 별도로 둔다. */}
        {currentProjectId && (
          <div style={{ marginTop: "auto" }}>
            <MemoEntryButton projectId={currentProjectId} variant="rail" />
          </div>
        )}
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
              <Fragment key={it.label}>
                <SubItem
                  item={it}
                  // "가장 긴 일치" 한 항목만 활성. prefix 충돌(예: /projects 와
                  // /projects/:id/members) 시 더 긴 쪽만 활성으로 인정하여
                  // "목록+멤버" 동시 active 문제를 방지.
                  isActive={it.href !== "#" && it.href === activeItemHref}
                  isHome={!!it.canPinHome && homePage === it.href}
                  onToggleHome={it.canPinHome ? () => toggleHomePage(it.href) : undefined}
                />
                {/* 구분선 — 항목 좌우 인셋(14px)에 맞춰 살짝 안쪽으로 들여서 사이드바 폭에
                    딱 붙지 않게 함 */}
                {it.dividerAfter && (
                  <div style={{ height: 1, background: "var(--color-border)", margin: "6px 14px" }} />
                )}
              </Fragment>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}

// ── 서브 패널 항목 (Link + 홈페이지 지정 별) ─────────────────────────────────
// 별 버튼을 Link 안에 중첩시키지 않고 형제로 둔다(버튼-안-링크는 잘못된 중첩이라
// Link는 flex:1로 라벨 영역만 차지하고, 별은 그 옆에 별도 버튼으로 존재).
function SubItem({
  item, isActive, isHome, onToggleHome,
}: {
  item: MenuItem;
  isActive: boolean;
  isHome: boolean;
  onToggleHome?: () => void;
}) {
  const isDisabled = item.href === "#";
  return (
    // 기존 .sp-subpane-item 클래스(배경/패딩/hover/active/disabled)를 그대로 outer div로 옮겨서
    // 하이라이트가 행 전체(별 버튼 자리까지)에 걸리도록 함 — Link는 아이콘+라벨만 담당.
    <div
      className={`sp-subpane-item${isActive ? " is-active" : ""}${isDisabled ? " is-disabled" : ""}${item.indent ? " is-indented" : ""}`}
      style={{ padding: 0 }}
    >
      <Link
        href={item.href}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          flex: 1, minWidth: 0,
          // 하위 개념 힌트(예: 화면 아래 영역) — 살짝 들여씀. .sp-subpane-item 은
          // padding:0 이 인라인 고정이라 CSS 클래스로는 못 건드리고, 실제 패딩을
          // 갖는 이 Link에서 직접 처리해야 함(2026-07-29).
          padding: item.indent ? "8px 14px 8px 26px" : "8px 14px",
          color: "inherit", textDecoration: "none",
        }}
        onClick={isDisabled ? (e) => e.preventDefault() : undefined}
      >
        <MenuIcon name={item.icon} size={15} />
        <span>{item.label}</span>
      </Link>
      {onToggleHome && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleHome(); }}
          title={isHome ? "내 홈페이지 해제" : "내 홈페이지로 지정 — 로그인 직후 이 화면으로 시작"}
          aria-pressed={isHome}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 22, height: 22, flexShrink: 0, marginRight: 6,
            border: "none", background: "none", cursor: "pointer", padding: 0,
            opacity: isHome ? 1 : 0.5,
          }}
        >
          {/* .sp-subpane-item svg { color: ... } 전역 규칙이 이 svg도 덮어써서
              색을 svg 엘리먼트에 직접 인라인으로 줌(상속 아닌 명시적 지정만 이길 수 있음) */}
          <StarIcon filled={isHome} color={isHome ? "var(--color-warning)" : "var(--color-text-tertiary)"} />
        </button>
      )}
    </div>
  );
}

// 홈페이지 지정 여부 표시 — 채워진 별 = 현재 홈페이지
// color를 svg에 직접 인라인으로 준다 — .sp-subpane-item svg 전역 규칙(색 강제 지정)을
// 이겨야 하는데, 상속(currentColor)으로는 그 규칙이 이겨버려서 명시적 지정이 필요함.
function StarIcon({ filled, color }: { filled: boolean; color: string }) {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill={filled ? color : "none"} stroke={color} strokeWidth={1.8} style={{ color }}>
      <path d="M12 2.5l3.09 6.26 6.91.99-5 4.87 1.18 6.88L12 17.9l-6.18 3.5L7 14.62l-5-4.87 6.91-.99L12 2.5z" strokeLinejoin="round" />
    </svg>
  );
}
