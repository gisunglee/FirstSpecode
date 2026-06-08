/**
 * IconLabPage — 좌측 레일(LNB 그룹) 아이콘 후보 비교용 임시 페이지 (/icon-lab)
 *
 * 역할:
 *   - LNB 레일의 각 그룹 메뉴별로 "현재 아이콘 + 대안 후보 4개"를 한눈에 비교
 *   - 사용자가 보고 마음에 드는 후보를 고르면(예: "분석 = 3번") menuIcons.tsx 에 반영
 *
 * 성격:
 *   - 임시(temporary) 페이지. 아이콘 확정 후 삭제 예정.
 *   - 어떤 비즈니스 로직도 없음. 순수 시각 비교용.
 *
 * 디자인:
 *   - 모든 색/간격은 semantic 토큰 사용 (하드코딩 금지 규칙 준수)
 *   - 아이콘은 LNB 와 동일한 라인 스타일: 24×24 viewBox, currentColor, stroke 2.0
 *   - data-theme(dark/light/dark-purple) 그대로 따라감
 */

import type { ReactNode } from "react";

// LNB 아이콘과 동일한 렌더링 규격 — 비교가 정확하려면 두께/스타일이 같아야 함
const ICON_STROKE_WIDTH = 2.0;

function Ico({ children, size = 26 }: { children: ReactNode; size?: number }) {
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
      aria-hidden
    >
      {children}
    </svg>
  );
}

// 후보 1개 = { 식별번호, svg children }
type Candidate = { id: string; node: ReactNode; note?: string };

// 그룹 1개 = { 메뉴명, 현재 아이콘, 후보들 }
type GroupRow = {
  label: string;
  currentNote: string;   // 현재 아이콘이 무엇인지 한 줄 설명
  current: ReactNode;
  candidates: Candidate[];
};

// ── 비교 데이터 ────────────────────────────────────────────────────────────────
// 후보 SVG 는 lucide 계열 path 를 인라인으로 옮긴 것. (현재 아이콘과 톤 통일)
const ROWS: GroupRow[] = [
  {
    label: "대시보드",
    currentNote: "4분할 그리드",
    current: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    candidates: [
      { id: "1", note: "대시보드(비대칭)", node: (
        <>
          <rect x="3" y="3" width="7" height="9" rx="1" />
          <rect x="14" y="3" width="7" height="5" rx="1" />
          <rect x="14" y="12" width="7" height="9" rx="1" />
          <rect x="3" y="16" width="7" height="5" rx="1" />
        </>
      )},
      { id: "2", note: "게이지", node: (
        <>
          <path d="m12 14 4-4" />
          <path d="M3.34 19a10 10 0 1 1 17.32 0" />
        </>
      )},
      { id: "3", note: "홈", node: (
        <>
          <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <path d="M9 22V12h6v10" />
        </>
      )},
      { id: "4", note: "레이아웃", node: (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18" />
          <path d="M9 21V9" />
        </>
      )},
    ],
  },
  {
    label: "프로젝트",
    currentNote: "폴더",
    current: (
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    ),
    candidates: [
      { id: "1", note: "열린 폴더", node: (
        <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6A2 2 0 0 1 18.45 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
      )},
      { id: "2", note: "서류가방", node: (
        <>
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
        </>
      )},
      { id: "3", note: "레이어", node: (
        <>
          <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
          <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
          <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
        </>
      )},
      { id: "4", note: "박스", node: (
        <>
          <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
          <path d="m3.3 7 8.7 5 8.7-5" />
          <path d="M12 22V12" />
        </>
      )},
    ],
  },
  {
    label: "분석",
    currentNote: "막대그래프(추세)",
    current: (
      <>
        <path d="M3 21h18" />
        <path d="M7 17V11" />
        <path d="M12 17V7" />
        <path d="M17 17v-4" />
      </>
    ),
    candidates: [
      { id: "1", note: "꺾은선", node: (
        <>
          <path d="M3 3v18h18" />
          <path d="m19 9-5 5-4-4-3 3" />
        </>
      )},
      { id: "2", note: "상승추세", node: (
        <>
          <path d="M16 7h6v6" />
          <path d="m22 7-8.5 8.5-5-5L2 17" />
        </>
      )},
      { id: "3", note: "파이차트", node: (
        <>
          <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
          <path d="M22 12A10 10 0 0 0 12 2v10z" />
        </>
      )},
      { id: "4", note: "맥박(activity)", node: (
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      )},
      { id: "5", note: "와이어프레임", node: (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18" />
          <path d="M9 9v12" />
          <path d="M13 13h4" />
          <path d="M13 16h4" />
        </>
      )},
      { id: "6", note: "눈(들여다봄)", node: (
        <>
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )},
      { id: "7", note: "망원경", node: (
        <>
          <path d="m10.07 12.49-6.18 1.32a.93.93 0 0 1-1.11-.7l-.54-2.15a1.07 1.07 0 0 1 .69-1.27l13.5-4.44" />
          <path d="m13.56 11.75 4.33-.92" />
          <path d="m16 21-3.1-6.21" />
          <path d="M16.49 5.94a2 2 0 0 1 1.46-2.43l1.09-.27a1 1 0 0 1 1.21.73l1.51 6.06a1 1 0 0 1-.73 1.21l-1.09.27a2 2 0 0 1-2.42-1.45z" />
          <path d="m8 21 3.1-6.21" />
          <circle cx="12" cy="13" r="2" />
        </>
      )},
      { id: "8", note: "귀(듣기)", node: (
        <>
          <path d="M6 8.5a6.5 6.5 0 1 1 13 0c0 6-6 6-6 10a3.5 3.5 0 1 1-7 0" />
          <path d="M15 8.5a2.5 2.5 0 0 0-5 0v1a2 2 0 1 1 0 4" />
        </>
      )},
      { id: "9", note: "현미경", node: (
        <>
          <path d="M6 18h8" />
          <path d="M3 22h18" />
          <path d="M14 22a7 7 0 1 0 0-14h-1" />
          <path d="M9 14h2" />
          <path d="M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Z" />
          <path d="M12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3" />
        </>
      )},
    ],
  },
  {
    label: "설계",
    currentNote: "T자(도면)",
    current: (
      <>
        <path d="M4 4h16v4H4z" />
        <path d="M10 8v12" />
        <path d="M14 8v12" />
      </>
    ),
    candidates: [
      { id: "1", note: "자(ruler)", node: (
        <>
          <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z" />
          <path d="m14.5 12.5 2-2" />
          <path d="m11.5 9.5 2-2" />
          <path d="m8.5 6.5 2-2" />
          <path d="m17.5 15.5 2-2" />
        </>
      )},
      { id: "2", note: "프레임", node: (
        <>
          <path d="M22 6H2" />
          <path d="M22 18H2" />
          <path d="M6 2v20" />
          <path d="M18 2v20" />
        </>
      )},
      { id: "3", note: "레이아웃 템플릿", node: (
        <>
          <rect x="3" y="3" width="18" height="7" rx="1" />
          <rect x="3" y="14" width="9" height="7" rx="1" />
          <rect x="16" y="14" width="5" height="7" rx="1" />
        </>
      )},
      { id: "4", note: "펜툴/연필", node: (
        <>
          <path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          <path d="m15 5 4 4" />
        </>
      )},
      { id: "5", note: "레고 브릭", node: (
        <>
          <rect x="4" y="8" width="16" height="12" rx="1" />
          <path d="M8 8V6a1 1 0 0 1 1-1 1 1 0 0 1 1 1v2" />
          <path d="M14 8V6a1 1 0 0 1 1-1 1 1 0 0 1 1 1v2" />
        </>
      )},
      { id: "6", note: "퍼즐(끼워맞춤)", node: (
        <path d="M19.44 7.85c-.05.32.06.65.29.88l1.57 1.57c.47.47.7 1.09.7 1.7s-.23 1.23-.7 1.7l-1.61 1.61a.98.98 0 0 1-.84.28c-.47-.07-.8-.48-.97-.93a2.5 2.5 0 1 0-3.21 3.22c.45.17.85.5.92.97a.98.98 0 0 1-.27.84l-1.61 1.61c-.47.47-1.09.7-1.7.7s-1.23-.23-1.7-.7l-1.57-1.57a1.03 1.03 0 0 0-.88-.29c-.49.07-.84.5-1.02.97a2.5 2.5 0 1 1-3.24-3.24c.46-.18.9-.53.97-1.02a1.03 1.03 0 0 0-.29-.88l-1.57-1.57A2.4 2.4 0 0 1 2 12c0-.62.24-1.23.71-1.7l1.52-1.53c.24-.24.58-.35.92-.3.51.08.88.53 1.07 1.01a2.5 2.5 0 1 0 3.26-3.26c-.48-.2-.93-.56-1.01-1.07a1.03 1.03 0 0 1 .3-.92l1.53-1.52A2.4 2.4 0 0 1 12 2c.62 0 1.23.24 1.7.71l1.57 1.57c.23.23.56.34.88.29.49-.07.84-.5 1.02-.97a2.5 2.5 0 1 1 3.24 3.24c-.46.18-.9.53-.97 1.02Z" />
      )},
      { id: "7", note: "자+연필", node: (
        <>
          <path d="M21.17 6.81a1 1 0 0 0-3.98-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z" />
          <path d="m8 6 2-2" />
          <path d="m18 16 2-2" />
          <path d="m17 11 4.3 4.3a1 1 0 0 1 0 1.4l-2.6 2.6a1 1 0 0 1-1.4 0L13 17" />
          <path d="m11 13-4.3-4.3a1 1 0 0 0-1.4 0l-2.6 2.6a1 1 0 0 0 0 1.4L7 17" />
        </>
      )},
      { id: "8", note: "제도 컴퍼스", node: (
        <>
          <path d="m12.99 6.74 1.93 3.44" />
          <path d="M19.14 12a10 10 0 0 1-14.28 0" />
          <path d="m21 21-2.16-3.84" />
          <path d="m3 21 8.02-14.26" />
          <circle cx="12" cy="5" r="2" />
        </>
      )},
    ],
  },
  {
    label: "테스트",
    currentNote: "클립보드+체크",
    current: (
      <>
        <rect x="6" y="4" width="12" height="17" rx="1.5" />
        <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
        <path d="M9 11l2 2 4-4" />
      </>
    ),
    candidates: [
      { id: "1", note: "체크 원", node: (
        <>
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <path d="m9 11 3 3L22 4" />
        </>
      )},
      { id: "2", note: "비커(실험)", node: (
        <>
          <path d="M10 2v7.31" />
          <path d="M14 9.3V2" />
          <path d="M8.5 2h7" />
          <path d="M14 9.3a6.5 6.5 0 1 1-4 0" />
          <path d="M5.5 16h13" />
        </>
      )},
      { id: "3", note: "체크리스트", node: (
        <>
          <path d="m3 17 2 2 4-4" />
          <path d="m3 7 2 2 4-4" />
          <path d="M13 6h8" />
          <path d="M13 12h8" />
          <path d="M13 18h8" />
        </>
      )},
      { id: "4", note: "방패+체크", node: (
        <>
          <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
          <path d="m9 12 2 2 4-4" />
        </>
      )},
    ],
  },
  {
    label: "공통 설계",
    currentNote: "책",
    current: (
      <>
        <path d="M4 4h12a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4Z" />
        <path d="M4 4v15" />
      </>
    ),
    candidates: [
      { id: "1", note: "펼친 책", node: (
        <>
          <path d="M12 7v14" />
          <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
        </>
      )},
      { id: "2", note: "서가(library)", node: (
        <>
          <path d="m16 6 4 14" />
          <path d="M12 6v14" />
          <path d="M8 8v12" />
          <path d="M4 4v16" />
        </>
      )},
      { id: "3", note: "패키지", node: (
        <>
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <path d="M16.5 9.4 7.55 4.24" />
          <path d="M3.3 7 12 12l8.7-5" />
          <path d="M12 22V12" />
        </>
      )},
      { id: "4", note: "블록(공용부품)", node: (
        <>
          <rect x="3" y="3" width="8" height="8" rx="1" />
          <rect x="13" y="13" width="8" height="8" rx="1" />
          <path d="M11 7h4a2 2 0 0 1 2 2v4" />
        </>
      )},
    ],
  },
  {
    label: "AI 작업실",
    currentNote: "스파클(별빛)",
    current: (
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
    candidates: [
      { id: "1", note: "스파클(채움형)", node: (
        <>
          <path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z" />
          <path d="M20 3v4" />
          <path d="M22 5h-4" />
          <path d="M4 17v2" />
          <path d="M5 18H3" />
        </>
      )},
      { id: "2", note: "봇(robot)", node: (
        <>
          <path d="M12 8V4H8" />
          <rect x="4" y="8" width="16" height="12" rx="2" />
          <path d="M2 14h2" />
          <path d="M20 14h2" />
          <path d="M15 13v2" />
          <path d="M9 13v2" />
        </>
      )},
      { id: "3", note: "칩(CPU)", node: (
        <>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <rect x="9" y="9" width="6" height="6" />
          <path d="M15 2v2" />
          <path d="M15 20v2" />
          <path d="M2 15h2" />
          <path d="M2 9h2" />
          <path d="M20 15h2" />
          <path d="M20 9h2" />
          <path d="M9 2v2" />
          <path d="M9 20v2" />
        </>
      )},
      { id: "4", note: "요술봉", node: (
        <>
          <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" />
          <path d="m14 7 3 3" />
          <path d="M5 6v4" />
          <path d="M7 8H3" />
        </>
      )},
    ],
  },
  {
    label: "스펙설정",
    currentNote: "문서+톱니",
    current: (
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
    candidates: [
      { id: "1", note: "슬라이더", node: (
        <>
          <line x1="4" x2="4" y1="21" y2="14" />
          <line x1="4" x2="4" y1="10" y2="3" />
          <line x1="12" x2="12" y1="21" y2="12" />
          <line x1="12" x2="12" y1="8" y2="3" />
          <line x1="20" x2="20" y1="21" y2="16" />
          <line x1="20" x2="20" y1="12" y2="3" />
          <line x1="2" x2="6" y1="14" y2="14" />
          <line x1="10" x2="14" y1="8" y2="8" />
          <line x1="18" x2="22" y1="16" y2="16" />
        </>
      )},
      { id: "2", note: "설정 노브", node: (
        <>
          <path d="M20 7h-9" />
          <path d="M14 17H5" />
          <circle cx="17" cy="17" r="3" />
          <circle cx="7" cy="7" r="3" />
        </>
      )},
      { id: "3", note: "톱니바퀴", node: (
        <>
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )},
      { id: "4", note: "문서+톱니(파일)", node: (
        <>
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          <path d="M15.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
          <circle cx="12" cy="15" r="2" />
          <path d="M12 12v1" />
          <path d="M12 17v1" />
          <path d="M9.5 15H10" />
          <path d="M14 15h.5" />
        </>
      )},
    ],
  },
  {
    label: "도움창고",
    currentNote: "라이프링(도움말)",
    current: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.1 9.5a3 3 0 0 1 5.8.5c0 2-3 2-3 4" />
        <path d="M12 17.5h.01" />
      </>
    ),
    candidates: [
      { id: "1", note: "도움 원(?)", node: (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        </>
      )},
      { id: "2", note: "정보(i)", node: (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </>
      )},
      { id: "3", note: "질문 말풍선", node: (
        <>
          <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        </>
      )},
      { id: "4", note: "구명튜브", node: (
        <>
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="4" />
          <line x1="4.93" x2="9.17" y1="4.93" y2="9.17" />
          <line x1="14.83" x2="19.07" y1="14.83" y2="19.07" />
          <line x1="14.83" x2="19.07" y1="9.17" y2="4.93" />
          <line x1="4.93" x2="9.17" y1="19.07" y2="14.83" />
        </>
      )},
      { id: "5", note: "프린터(문서출력)", node: (
        <>
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" />
          <rect x="6" y="14" width="12" height="8" rx="1" />
        </>
      )},
      { id: "6", note: "헤드셋(상담)", node: (
        <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5a9 9 0 0 1 18 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />
      )},
      { id: "7", note: "돕는 손", node: (
        <>
          <path d="M11 12h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 14" />
          <path d="m7 18 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9" />
          <path d="m2 13 6 6" />
        </>
      )},
      { id: "8", note: "창고(warehouse)", node: (
        <>
          <path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z" />
          <path d="M6 18h12" />
          <path d="M6 14h12" />
          <path d="M6 10h12" />
        </>
      )},
    ],
  },
  {
    label: "데이터 조회",
    currentNote: "원통(DB)",
    current: (
      <>
        <ellipse cx="12" cy="5" rx="8" ry="2.5" />
        <path d="M4 5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V5" />
        <path d="M4 11v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6" />
      </>
    ),
    candidates: [
      { id: "1", note: "서버", node: (
        <>
          <rect x="2" y="2" width="20" height="8" rx="2" />
          <rect x="2" y="14" width="20" height="8" rx="2" />
          <path d="M6 6h.01" />
          <path d="M6 18h.01" />
        </>
      )},
      { id: "2", note: "검색(돋보기)", node: (
        <>
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </>
      )},
      { id: "3", note: "테이블", node: (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18" />
          <path d="M3 15h18" />
          <path d="M12 3v18" />
        </>
      )},
      { id: "4", note: "DB+검색", node: (
        <>
          <ellipse cx="10" cy="5" rx="7" ry="2.3" />
          <path d="M3 5v6c0 1.3 3.1 2.3 7 2.3" />
          <path d="M3 11v6c0 1.3 3.1 2.3 7 2.3" />
          <circle cx="17" cy="16" r="3" />
          <path d="m21 20-1.8-1.8" />
        </>
      )},
    ],
  },
  {
    label: "시스템 관리",
    currentNote: "방패+체크",
    current: (
      <>
        <path d="M12 3l8 3v6c0 4.5-3.5 8.5-8 9-4.5-.5-8-4.5-8-9V6l8-3z" />
        <path d="M9 12l2 2 4-4" />
      </>
    ),
    candidates: [
      { id: "1", note: "방패+경고", node: (
        <>
          <path d="M12 3l8 3v6c0 4.5-3.5 8.5-8 9-4.5-.5-8-4.5-8-9V6l8-3z" />
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
        </>
      )},
      { id: "2", note: "자물쇠", node: (
        <>
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </>
      )},
      { id: "3", note: "톱니바퀴", node: (
        <>
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )},
      { id: "4", note: "사용자+설정", node: (
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
      )},
    ],
  },
];

type AppIconCandidate = {
  id: string;
  name: string;
  note: string;
  node: ReactNode;
  tone?: "accent" | "brand" | "mixed";
};

const APP_ICON_CANDIDATES: AppIconCandidate[] = [
  {
    id: "A",
    name: "Bolt",
    note: "현재 로그인 화면 계열",
    tone: "accent",
    node: (
      <path d="M36 6 18 36h13l-3 22 18-32H33z" />
    ),
  },
  {
    id: "B",
    name: "Spec Mark",
    note: "S + 코드 브래킷",
    tone: "mixed",
    node: (
      <>
        <path d="M24 20c2.4-4.2 13.5-4.3 16.4.2" />
        <path d="M39 20c-1.5 5.2-15.4 3.8-15.4 11.5 0 7.2 13.2 7.4 17.2 2.7" />
        <path d="M21 17 12 32l9 15" />
        <path d="m43 17 9 15-9 15" />
      </>
    ),
  },
  {
    id: "C",
    name: "Spec Cube",
    note: "설계 산출물 블록",
    tone: "brand",
    node: (
      <>
        <path d="M32 8 52 19.5v24L32 56 12 43.5v-24z" />
        <path d="M12 19.5 32 31l20-11.5" />
        <path d="M32 31v25" />
        <path d="m22 14 20 11.5" />
      </>
    ),
  },
  {
    id: "D",
    name: "PRD Check",
    note: "문서 + 검증",
    tone: "mixed",
    node: (
      <>
        <path d="M20 8h18l9 9v39H20z" />
        <path d="M38 8v10h9" />
        <path d="M25 29h14" />
        <path d="M25 38h10" />
        <path d="m36 47 5 5 12-14" />
      </>
    ),
  },
  {
    id: "E",
    name: "Flow Core",
    note: "요구-설계-구현 연결",
    tone: "brand",
    node: (
      <>
        <circle cx="32" cy="32" r="7" />
        <circle cx="15" cy="18" r="5" />
        <circle cx="49" cy="18" r="5" />
        <circle cx="15" cy="47" r="5" />
        <circle cx="49" cy="47" r="5" />
        <path d="M20 21.5 27 28" />
        <path d="m44 21.5-7 6.5" />
        <path d="m20 44 7-7" />
        <path d="m44 44-7-7" />
      </>
    ),
  },
  {
    id: "F",
    name: "Blueprint",
    note: "화면 설계/명세",
    tone: "accent",
    node: (
      <>
        <rect x="13" y="14" width="38" height="36" rx="4" />
        <path d="M13 25h38" />
        <path d="M25 25v25" />
        <path d="M32 34h11" />
        <path d="M32 42h8" />
        <path d="M18 18h.1" />
        <path d="M24 18h.1" />
      </>
    ),
  },
  {
    id: "G",
    name: "Spark Code",
    note: "AI와 코드 생성",
    tone: "mixed",
    node: (
      <>
        <path d="M32 7 36.5 24 54 32l-17.5 8L32 57l-4.5-17L10 32l17.5-8z" />
        <path d="m24 25-7 7 7 7" />
        <path d="m40 25 7 7-7 7" />
      </>
    ),
  },
  {
    id: "H",
    name: "Spec Lens",
    note: "분석 후 명확화",
    tone: "brand",
    node: (
      <>
        <circle cx="28" cy="28" r="15" />
        <path d="m39 39 12 12" />
        <path d="M21 28h14" />
        <path d="M28 21v14" />
        <path d="m24 42 5-5" />
      </>
    ),
  },
];

export default function IconLabPage() {
  return (
    <div
      style={{
        minHeight:  "100vh",
        background: "var(--color-bg-root)",
        color:      "var(--color-text-primary)",
        padding:    "40px 48px 80px",
        boxSizing:  "border-box",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* 헤더 */}
        <h1 style={{
          margin:     "0 0 8px",
          fontSize:   "var(--text-3xl)",
          fontWeight: 700,
          color:      "var(--color-text-heading)",
        }}>
          좌측 메뉴 아이콘 후보 비교
        </h1>
        <p style={{
          margin:    "0 0 8px",
          fontSize:  "var(--text-lg)",
          color:     "var(--color-text-secondary)",
          lineHeight: 1.7,
        }}>
          각 메뉴마다 <strong style={{ color: "var(--color-text-heading)" }}>현재 아이콘</strong>과
          후보 4개를 나란히 뒀습니다. 마음에 드는 걸 고르고
          <strong style={{ color: "var(--color-brand)" }}> &quot;분석 = 2번&quot;</strong> 처럼
          알려주시면 실제 메뉴에 반영하겠습니다.
        </p>
        <p style={{
          margin:    "0 0 32px",
          fontSize:  "var(--text-sm)",
          color:     "var(--color-text-tertiary)",
        }}>
          ※ 임시 페이지입니다. 우측 상단 테마 토글로 다크/라이트 모두 확인해 보세요. (확정 후 삭제)
        </p>

        {/* 그룹별 행 */}
        <section
          style={{
            marginBottom: 32,
            padding: "20px",
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-card)",
          }}
        >
          <div style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: "var(--space-4)",
            marginBottom: "var(--space-4)",
          }}>
            <div>
              <h2 style={{
                margin: 0,
                fontSize: "var(--text-2xl)",
                fontWeight: 700,
                color: "var(--color-text-heading)",
              }}>
                SPECODE 앱 아이콘 후보
              </h2>
              <p style={{
                margin: "var(--space-1) 0 0",
                fontSize: "var(--text-sm)",
                color: "var(--color-text-secondary)",
                lineHeight: 1.6,
              }}>
                로그인 카드 상단과 파비콘에 쓸 수 있는 둥근 사각형 마크 후보입니다.
              </p>
            </div>
            <div style={{
              fontSize: "var(--text-xs)",
              color: "var(--color-text-tertiary)",
              fontFamily: "var(--font-mono)",
            }}>
              64px preview
            </div>
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))",
            gap: "var(--space-3)",
          }}>
            {APP_ICON_CANDIDATES.map((icon) => (
              <AppIconTile key={icon.id} icon={icon} />
            ))}
          </div>
        </section>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {ROWS.map((row) => (
            <section
              key={row.label}
              style={{
                display:      "grid",
                gridTemplateColumns: "150px 1fr",
                gap:          20,
                alignItems:   "center",
                padding:      "18px 20px",
                background:   "var(--color-bg-card)",
                border:       "1px solid var(--color-border-subtle)",
                borderRadius: "var(--radius-card)",
              }}
            >
              {/* 좌: 메뉴명 */}
              <div>
                <div style={{
                  fontSize:   "var(--text-lg)",
                  fontWeight: 700,
                  color:      "var(--color-text-heading)",
                }}>
                  {row.label}
                </div>
                <div style={{
                  marginTop: 2,
                  fontSize:  "var(--text-xs)",
                  color:     "var(--color-text-tertiary)",
                }}>
                  현재: {row.currentNote}
                </div>
              </div>

              {/* 우: 현재 + 후보들 */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                <IconTile label="현재" note={row.currentNote} highlight>
                  {row.current}
                </IconTile>
                {row.candidates.map((c) => (
                  <IconTile key={c.id} label={`${c.id}번`} note={c.note}>
                    {c.node}
                  </IconTile>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 아이콘 1칸 (현재/후보 공용) ───────────────────────────────────────────────
function AppIconTile({ icon }: { icon: AppIconCandidate }) {
  const background =
    icon.tone === "brand"
      ? "linear-gradient(135deg, var(--color-brand), var(--color-info))"
      : icon.tone === "mixed"
        ? "linear-gradient(135deg, var(--color-accent), var(--color-brand))"
        : "linear-gradient(135deg, var(--color-accent), var(--color-warning))";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "var(--space-4) var(--space-2)",
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-card)",
      }}
    >
      <div
        style={{
          width: "calc(var(--space-12) + var(--space-4))",
          height: "calc(var(--space-12) + var(--space-4))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-text-inverse)",
          background,
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <svg
          width="44"
          height="44"
          viewBox="0 0 64 64"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          {icon.node}
        </svg>
      </div>
      <div style={{
        fontSize: "var(--text-xs)",
        fontWeight: 700,
        color: "var(--color-brand)",
        fontFamily: "var(--font-mono)",
      }}>
        {icon.id}
      </div>
      <div style={{
        fontSize: "var(--text-sm)",
        fontWeight: 700,
        color: "var(--color-text-primary)",
        textAlign: "center",
      }}>
        {icon.name}
      </div>
      <div style={{
        fontSize: "var(--text-xs)",
        color: "var(--color-text-tertiary)",
        lineHeight: 1.35,
        textAlign: "center",
      }}>
        {icon.note}
      </div>
    </div>
  );
}

function IconTile({
  children, label, note, highlight = false,
}: {
  children: ReactNode;
  label:    string;
  note?:    string;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        display:        "flex",
        flexDirection:  "column",
        alignItems:     "center",
        gap:            6,
        width:          110,
        padding:        "14px 8px 10px",
        // 현재 아이콘은 브랜드 톤으로 구분 — 비교 기준점이 한눈에 보이도록
        background:     highlight ? "var(--color-brand-subtle)" : "var(--color-bg-elevated)",
        border:         highlight
          ? "1px solid var(--color-brand-border)"
          : "1px solid var(--color-border-subtle)",
        borderRadius:   "var(--radius-card)",
      }}
    >
      {/* 아이콘 — LNB 레일과 같은 색(보조 텍스트색)으로 표시 */}
      <div style={{ color: highlight ? "var(--color-brand)" : "var(--color-text-secondary)" }}>
        <Ico size={28}>{children}</Ico>
      </div>
      <div style={{
        fontSize:   "var(--text-xs)",
        fontWeight: 700,
        color:      highlight ? "var(--color-brand)" : "var(--color-text-primary)",
      }}>
        {label}
      </div>
      {note && (
        <div style={{
          fontSize:   "10px",
          color:      "var(--color-text-tertiary)",
          textAlign:  "center",
          lineHeight: 1.3,
        }}>
          {note}
        </div>
      )}
    </div>
  );
}
