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
  | "g_common" | "g_ai" | "g_spec_config" | "g_help" | "g_data"
  // 항목 (서브 패널)
  | "i_dashboard"
  | "i_projectList" | "i_projectSettings" | "i_members" | "i_profile" | "i_envSettings"
  | "i_task" | "i_requirement" | "i_userStory" | "i_baseline" | "i_planningBatch" | "i_planStudio"
  | "i_unitWork" | "i_screen" | "i_area" | "i_function" | "i_dbTable"
  | "i_standardGuide" | "i_commonCode" | "i_referenceInfo"
  | "i_aiTask" | "i_planImport" | "i_designImport" | "i_promptTemplate"
  | "i_designTemplate"
  | "i_review" | "i_memo"
  | "i_graph" | "i_changeLog" | "i_diffTest";

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
  // 프로젝트 — 폴더
  g_project: (
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  ),
  // 분석 — 막대그래프 + 추세선
  g_analysis: (
    <>
      <path d="M3 21h18" />
      <path d="M7 17V11" />
      <path d="M12 17V7" />
      <path d="M17 17v-4" />
    </>
  ),
  // 설계 — 도면(자/T자형)
  g_design: (
    <>
      <path d="M4 4h16v4H4z" />
      <path d="M10 8v12" />
      <path d="M14 8v12" />
    </>
  ),
  // 공통 설계 — 책
  g_common: (
    <>
      <path d="M4 4h12a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4Z" />
      <path d="M4 4v15" />
    </>
  ),
  // AI 작업실 — 별빛(스파클)
  g_ai: (
    <>
      <path d="M12 3v4" />
      <path d="M12 17v4" />
      <path d="M3 12h4" />
      <path d="M17 12h4" />
      <path d="M5.6 5.6l2.8 2.8" />
      <path d="M15.6 15.6l2.8 2.8" />
      <path d="M18.4 5.6l-2.8 2.8" />
      <path d="M8.4 15.6l-2.8 2.8" />
    </>
  ),
  // 스펙설정 — 문서 + 톱니(도구의 메타 설정)
  g_spec_config: (
    <>
      <path d="M5 3h9l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v5h5" />
      <circle cx="12" cy="15" r="2" />
      <path d="M12 11v1.5" />
      <path d="M12 17.5V19" />
      <path d="M8.5 15H10" />
      <path d="M14 15h1.5" />
    </>
  ),
  // 도움창고 — 라이프링/도움말
  g_help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.1 9.5a3 3 0 0 1 5.8.5c0 2-3 2-3 4" />
      <path d="M12 17.5h.01" />
    </>
  ),
  // 데이터 조회 — 데이터베이스(원통)
  g_data: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="2.5" />
      <path d="M4 5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V5" />
      <path d="M4 11v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6" />
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
  i_requirement: (
    <>
      <path d="M9 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="M9 14l2 2 4-4" />
    </>
  ),
  i_userStory: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </>
  ),
  i_baseline: (
    <>
      <path d="M4 21V4" />
      <path d="M4 4h12l-2 4 2 4H4" />
    </>
  ),
  i_planningBatch: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
      <path d="M8 14h.01" />
      <path d="M12 14h.01" />
      <path d="M16 14h.01" />
      <path d="M8 18h.01" />
      <path d="M12 18h.01" />
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
  i_function: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v4" />
      <path d="M12 19v4" />
      <path d="M4.2 4.2l2.9 2.9" />
      <path d="M16.9 16.9l2.9 2.9" />
      <path d="M1 12h4" />
      <path d="M19 12h4" />
      <path d="M4.2 19.8l2.9-2.9" />
      <path d="M16.9 7.1l2.9-2.9" />
    </>
  ),
  i_dbTable: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="2.5" />
      <path d="M4 5v14c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V5" />
      <path d="M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5" />
    </>
  ),
  i_standardGuide: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
      <path d="M9 7h6" />
      <path d="M9 11h6" />
    </>
  ),
  i_commonCode: (
    <>
      <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0l-7.2-7.2a2 2 0 0 1-.6-1.4V5a2 2 0 0 1 2-2h7a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 .2 2.6Z" />
      <circle cx="8" cy="8" r="1.3" />
    </>
  ),
  i_referenceInfo: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
    </>
  ),
  i_aiTask: (
    <>
      <path d="M12 3v4" />
      <path d="M12 17v4" />
      <path d="M5.6 5.6l2.8 2.8" />
      <path d="M15.6 15.6l2.8 2.8" />
      <path d="M3 12h4" />
      <path d="M17 12h4" />
      <path d="M18.4 5.6l-2.8 2.8" />
      <path d="M8.4 15.6l-2.8 2.8" />
    </>
  ),
  i_planImport: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </>
  ),
  i_designImport: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5" />
      <path d="M12 3v12" />
    </>
  ),
  i_promptTemplate: (
    <>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
      <path d="M8 10h8" />
      <path d="M8 13h5" />
    </>
  ),
  // 설계 양식 — 문서 + 연필(양식 편집)
  i_designTemplate: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9Z" />
      <path d="M14 3v6h6" />
      <path d="M8 14l4.5-4.5 2.5 2.5L10.5 16.5H8Z" />
    </>
  ),
  i_review: (
    <>
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.4-.7L3 21l1.9-5.4A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z" />
    </>
  ),
  i_memo: (
    <>
      <path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9Z" />
      <path d="M14 3v7h7" />
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
};

// ── 외부 사용 컴포넌트 ────────────────────────────────────────────────────────
export function MenuIcon({ name, size = 18 }: { name: MenuIconKey; size?: number }) {
  return <S size={size}>{ICONS[name]}</S>;
}
