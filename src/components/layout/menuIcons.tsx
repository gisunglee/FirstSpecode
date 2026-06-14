/**
 * menuIcons — 사이드바 전용 모노크롬 SVG 아이콘 세트
 *
 * 디자인 원칙:
 *   - 단색(currentColor) — 부모 텍스트 색을 그대로 따라감 (테마 자동 대응)
 *   - 라인 스트로크 스타일로 통일 (lucide 계열)
 *   - 24×24 viewBox
 *   - 그룹별/메뉴별 의미 매칭에 우선, 시각적 일관성 유지
 *
 * 아이콘 외부 라이브러리(lucide-react) 미도입:
 *   - 의존성 추가 없이 SPECODE만 쓸 30여 개 아이콘만 인라인으로 보유
 *
 * 획 두께 조정 이력:
 *   - 초기값 1.7 (얇고 미니멀) → 1.7 에서는 "가늘어 흐려 보인다" 피드백
 *   - 현재 값 2.0 (한 단계 굵게. 배경 대비 가독성↑, 전체 미니멀 톤 유지)
 *   - 롤백하려면 아래 ICON_STROKE_WIDTH 값을 1.7 로 변경 (한 줄)
 */

import type { ReactNode } from "react";

// 아이콘 획 두께 — 모든 메뉴 아이콘에 일괄 적용되는 단일 진실 공급원
// 수정 시 전체 아이콘에 즉시 반영되므로 미세 튜닝 용이.
const ICON_STROKE_WIDTH = 2.0;

// ── 공통 SVG 래퍼 ─────────────────────────────────────────────────────────────
function S({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export type MenuIconKey =
  // 그룹 (레일)
  | "g_dashboard" | "g_project" | "g_analysis" | "g_design"
  | "g_test"     // 테스트 그룹 (체크리스트)
  | "g_common" | "g_ai" | "g_spec_config" | "g_help" | "g_data"
  // 시스템 관리 (SUPER_ADMIN 전용) — 사용자+설정 아이콘
  | "g_admin"
  // 항목 (서브 패널)
  | "i_dashboard"
  | "i_projectList" | "i_projectSettings" | "i_members" | "i_profile" | "i_envSettings"
  | "i_task" | "i_requirement" | "i_userStory" | "i_planningBatch" | "i_planStudio"
  | "i_unitWork" | "i_screen" | "i_area" | "i_function" | "i_dbTable"
  | "i_standardGuide" | "i_commonCode" | "i_referenceInfo"
  | "i_aiTask" | "i_planImport" | "i_designImport" | "i_promptTemplate"
  | "i_designTemplate"
  | "i_review" | "i_memo" | "i_docs" | "i_library"
  | "i_graph" | "i_changeLog" | "i_diffTest" | "i_cleanup"
  // 신규 대시보드 메뉴 (활동/포커스/캘린더/PM)
  | "i_activity" | "i_focus" | "i_calendar" | "i_pm"
  // 테스트 항목 — 단위(단일 박스)·통합(연결된 박스들)
  | "i_testSpecUnit" | "i_testSpecIntegration";

const ICONS: Record<MenuIconKey, ReactNode> = {
  // ── 그룹 아이콘 (레일) ──────────────────────────────────────────────────────
  // 대시보드 — 4분할 그리드
  g_dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  // 프로젝트 — 박스(3D 큐브). 프로젝트를 "담는 단위"로 표현
  g_project: (
    <>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </>
  ),
  // 분석 — 현미경. 요구사항을 "자세히 들여다본다"는 의미
  g_analysis: (
    <>
      <path d="M6 18h8" />
      <path d="M3 22h18" />
      <path d="M14 22a7 7 0 1 0 0-14h-1" />
      <path d="M9 14h2" />
      <path d="M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Z" />
      <path d="M12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3" />
    </>
  ),
  // 설계 — 연필(펜). 직접 그려 만든다는 의미
  g_design: (
    <>
      <path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </>
  ),
  // 테스트 — 체크리스트. 항목별 확인(QA) 의미
  g_test: (
    <>
      <path d="m3 17 2 2 4-4" />
      <path d="m3 7 2 2 4-4" />
      <path d="M13 6h8" />
      <path d="M13 12h8" />
      <path d="M13 18h8" />
    </>
  ),
  // 공통 설계 — 블록(공용 부품). 여러 곳에서 끼워 쓰는 공통 자산 의미
  g_common: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <rect x="13" y="13" width="8" height="8" rx="1" />
      <path d="M11 7h4a2 2 0 0 1 2 2v4" />
    </>
  ),
  // AI 작업실 — 봇(로봇). AI 에이전트 의미
  g_ai: (
    <>
      <path d="M12 8V4H8" />
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </>
  ),
  // 스펙설정 — 톱니바퀴. 도구의 메타 설정 의미
  g_spec_config: (
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  // 도움창고 — 돕는 손(hand-helping). "도움을 건넨다"는 의미
  g_help: (
    <>
      <path d="M11 12h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 14" />
      <path d="m7 18 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9" />
      <path d="m2 13 6 6" />
    </>
  ),
  // 데이터 조회 — 데이터베이스 + 돋보기. "데이터를 찾아본다"는 의미
  g_data: (
    <>
      <ellipse cx="10" cy="5" rx="7" ry="2.3" />
      <path d="M3 5v6c0 1.3 3.1 2.3 7 2.3" />
      <path d="M3 11v6c0 1.3 3.1 2.3 7 2.3" />
      <circle cx="17" cy="16" r="3" />
      <path d="m21 20-1.8-1.8" />
    </>
  ),
  // 시스템 관리 — 사용자 + 설정. 사용자/시스템 운영 관리 의미
  g_admin: (
    <>
      <circle cx="9" cy="7" r="4" />
      <path d="M2 21v-1a6 6 0 0 1 9-5.2" />
      <circle cx="18" cy="17" r="2.5" />
      <path d="M18 13.5v1" />
      <path d="M18 19.5v1" />
      <path d="m15.4 15.5.9.5" />
      <path d="m19.7 18 .9.5" />
      <path d="m15.4 18.5.9-.5" />
      <path d="m19.7 16 .9-.5" />
    </>
  ),

  // ── 항목 아이콘 (서브 패널) ─────────────────────────────────────────────────
  i_dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </>
  ),
  i_projectList: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </>
  ),
  i_projectSettings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </>
  ),
  i_members: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  i_profile: (
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  i_envSettings: (
    <>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.7-3.7a6 6 0 0 1-7.9 7.9L6.5 20.5a2.1 2.1 0 0 1-3-3l8.9-8.9a6 6 0 0 1 7.9-7.9l-3.7 3.7Z" />
    </>
  ),
  i_task: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4v3h6V4" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
    </>
  ),
  // 요구사항 — 문서 + 체크. "충족해야 할 명세 항목" 의미.
  // 과업(클립보드)과 실루엣이 거의 같아 혼동되던 문제 → 클립 없는 문서로 분리.
  i_requirement: (
    <>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z" />
      <path d="M14 2v6h6" />
      <path d="m9 15 2 2 4-4" />
    </>
  ),
  // 사용자스토리 — 인물 + 설명 카드. "사용자 관점의 이야기(As a user…)" 를 표현.
  // 이전 빈 책 모양은 '표준 가이드'(노트)와 거의 같아 혼동되어 변경.
  i_userStory: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2.2" />
      <path d="M5.5 16a3.5 3.5 0 0 1 7 0" />
      <path d="M15 9.5h3" />
      <path d="M15 13h3" />
    </>
  ),
  // 요구분석 일괄 편집 — 목록(여러 줄) + 펜. "여러 항목을 한 번에 편집" 의미.
  // 이전 달력 아이콘은 의미가 전혀 맞지 않아 변경.
  i_planningBatch: (
    <>
      <path d="M4 7h16" />
      <path d="M4 12h9" />
      <path d="M4 17h6" />
      <path d="M18.5 12a1.5 1.5 0 0 1 2.1 2.1l-6.6 6.6-2.8.7.7-2.8z" />
    </>
  ),
  i_planStudio: (
    <>
      <circle cx="13.5" cy="6.5" r="1.5" />
      <circle cx="17.5" cy="10.5" r="1.5" />
      <circle cx="8.5" cy="7.5" r="1.5" />
      <circle cx="6.5" cy="12.5" r="1.5" />
      <path d="M12 22a10 10 0 1 1 0-20c5.5 0 10 4 10 9 0 2.7-2.3 5-5 5h-1.8a2 2 0 0 0-1.4 3.4 2 2 0 0 1-1.4 3.4Z" />
    </>
  ),
  i_unitWork: (
    <>
      <path d="M3 8l9-5 9 5-9 5-9-5Z" />
      <path d="M3 13l9 5 9-5" />
      <path d="M3 18l9 5 9-5" />
    </>
  ),
  i_screen: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </>
  ),
  i_area: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <rect x="13" y="3" width="8" height="8" rx="1" />
      <rect x="3" y="13" width="8" height="8" rx="1" />
      <rect x="13" y="13" width="8" height="8" rx="1" />
    </>
  ),
  // 기능 — 함수 기호 fx(square-function). "기능=function" 을 직관적으로 표현.
  // 이전엔 태양/방사형이라 의미가 안 맞았고, 렌치/톱니는 '설정'과 혼동되어 배제.
  i_function: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 17c2 0 2.8-1 2.8-2.8V10c0-2 1-3.3 3.2-3" />
      <path d="M9 11.2h5.7" />
    </>
  ),
  i_dbTable: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="2.5" />
      <path d="M4 5v14c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V5" />
      <path d="M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5" />
    </>
  ),
  // 표준 가이드 — 펼친 책(지침서/매뉴얼). 팀이 따르는 표준 안내.
  i_standardGuide: (
    <>
      <path d="M12 7v14" />
      <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
    </>
  ),
  // 공통코드 — 중괄호 {}. 코드(값) 관리를 직관적으로 표현.
  i_commonCode: (
    <>
      <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" />
      <path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" />
    </>
  ),
  // 기준 정보 — 표(격자). 프로젝트의 기준이 되는 마스터 데이터.
  i_referenceInfo: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
      <path d="M3 15h18" />
      <path d="M12 3v18" />
    </>
  ),
  // AI 태스크 — 스파클(반짝임). AI 가 생성/처리하는 작업.
  // 그룹 레일이 이미 '봇'이라, 항목은 'AI 산출' 느낌의 스파클로 구분.
  i_aiTask: (
    <>
      <path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
      <path d="M4 17v2" />
      <path d="M5 18H3" />
    </>
  ),
  // 기획 가져오기 — ↓가져오기 화살표 + 목록. AI 가 만든 기획(JSON)을 시스템에 등록.
  // 설계 가져오기와 방향(↓)을 통일하고, 대상(목록 vs 화면)으로만 구분.
  i_planImport: (
    <>
      <path d="M12 3v8" />
      <path d="m8 9 4 4 4-4" />
      <path d="M4 17h16" />
      <path d="M4 21h10" />
    </>
  ),
  // 설계 가져오기 — ↓가져오기 화살표 + 화면. AI 가 만든 설계(JSON)를 시스템에 등록.
  i_designImport: (
    <>
      <path d="M12 3v8" />
      <path d="m8 9 4 4 4-4" />
      <rect x="3" y="15" width="18" height="7" rx="2" />
    </>
  ),
  i_promptTemplate: (
    <>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
      <path d="M8 10h8" />
      <path d="M8 13h5" />
    </>
  ),
  // 설계 양식 — 레이아웃 템플릿(서식 구조). 설계 산출물의 '양식/서식' 을 표현.
  // 이전 '문서+연필'은 일반 문서 편집처럼 보여 양식 느낌이 약했음.
  i_designTemplate: (
    <>
      <rect x="3" y="3" width="18" height="7" rx="1" />
      <rect x="3" y="14" width="9" height="7" rx="1" />
      <rect x="16" y="14" width="5" height="7" rx="1" />
    </>
  ),
  i_review: (
    <>
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.4-.7L3 21l1.9-5.4A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z" />
    </>
  ),
  // 메모 — 스티키 노트(접힌 모서리). 짧은 기록/메모.
  // 이전 모서리 접힌 빈 파일은 일반 문서와 구분이 약했음.
  i_memo: (
    <>
      <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8l8-8V5a2 2 0 0 0-2-2Z" />
      <path d="M13 21v-6a2 2 0 0 1 2-2h6" />
    </>
  ),

  // 책 펼침 — Docs 의 "공식 문서" 를 직관적으로 표현
  i_docs: (
    <>
      <path d="M3 5a2 2 0 0 1 2-2h6v18H5a2 2 0 0 1-2-2Z" />
      <path d="M21 5a2 2 0 0 0-2-2h-6v18h6a2 2 0 0 0 2-2Z" />
      <path d="M7 8h2" />
      <path d="M7 12h2" />
      <path d="M15 8h2" />
      <path d="M15 12h2" />
    </>
  ),
  // 책장 — "산출물 도서관/문서실" 메뉴용 (책 3권 세로로 꽂혀 있는 형태)
  i_library: (
    <>
      <path d="M5 4v16" />
      <path d="M3 4h4v16H3z" />
      <path d="M9 4h4v16H9z" />
      <path d="M11 8h0.01" />
      <path d="M15 4l3 1-3 15-3-1z" />
    </>
  ),
  // 휴지통 — "정보 삭제" / cleanup 메뉴용
  i_cleanup: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M5 6l1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </>
  ),
  i_graph: (
    <>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8.2 11l7.6-3.7" />
      <path d="M8.2 13l7.6 3.7" />
    </>
  ),
  i_changeLog: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v4h4" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  i_diffTest: (
    <>
      <path d="M16 18l6-6-6-6" />
      <path d="M8 6l-6 6 6 6" />
    </>
  ),
  // 활동 피드 — 가로 라인 세 줄(스트림)
  i_activity: (
    <>
      <path d="M4 7h16" />
      <path d="M4 12h10" />
      <path d="M4 17h13" />
    </>
  ),
  // 포커스 — 과녁(타깃)
  i_focus: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </>
  ),
  // 캘린더 — 달력
  i_calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </>
  ),
  // PM 대시보드 — 사람 + 막대그래프 (자원·일정 관리 시각)
  i_pm: (
    <>
      <circle cx="9" cy="6" r="3" />
      <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
      <path d="M17 17V9" />
      <path d="M20 17v-4" />
    </>
  ),
  // 단위 테스트 명세서 — 플라스크 1개(실험). "하나의 단위를 검증" 의미.
  i_testSpecUnit: (
    <>
      <path d="M9 3h6" />
      <path d="M10 3v6.5L4.7 18A1.5 1.5 0 0 0 6 20.3h12a1.5 1.5 0 0 0 1.3-2.3L14 9.5V3" />
      <path d="M7.2 14h9.6" />
    </>
  ),
  // 통합 테스트 명세서 — 시험관 여러 개. "여러 단위를 함께 검증(통합)" 의미.
  i_testSpecIntegration: (
    <>
      <path d="M9 2v17.5A2.5 2.5 0 0 1 4 19.5V2" />
      <path d="M20 2v17.5a2.5 2.5 0 0 1-5 0V2" />
      <path d="M3 2h7" />
      <path d="M14 2h7" />
      <path d="M9 16H4" />
      <path d="M20 16h-5" />
    </>
  ),
};

// ── 외부 사용 컴포넌트 ────────────────────────────────────────────────────────
export function MenuIcon({ name, size = 18 }: { name: MenuIconKey; size?: number }) {
  return <S size={size}>{ICONS[name]}</S>;
}
