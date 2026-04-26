/**
 * exports/docx/tokens.ts — Word 출력 양식 디자인 토큰
 *
 * 역할:
 *   - 폰트, 색상, 용지, 여백 등 양식의 시각 토큰을 한 곳에 모은 상수 모음
 *   - 양식 변경(공공/민간 발주처별 색상 등) 시 이 파일만 수정하면 된다
 *
 * 토큰 사용 규칙:
 *   - helpers.ts / frame.ts / requirement.ts 에서는 절대 색상/크기 하드코딩 금지
 *   - 모두 이 파일의 상수를 import 해서 사용
 */

// ─── 폰트 ───────────────────────────────────────────────
// 한국 공공 SI 표준 폰트. 모든 docx 셀/문단의 기본 폰트로 사용.
export const FONT = "맑은 고딕";

// ─── 색상 (HEX, # 없이) ──────────────────────────────────
// 진청 — 표지 헤딩, 표 헤더 배경
export const COLOR_PRIMARY     = "1F4E79";
// 연청 — 표 라벨 셀 배경 (기본 정보 표 등)
export const COLOR_LABEL_BG    = "D9E2F3";
// 표 보더 회색
export const COLOR_BORDER      = "808080";
// 머리글/바닥글 등 보조 텍스트 회색
export const COLOR_MUTED       = "808080";
// 기본 검정 (셀 텍스트 등)
export const COLOR_TEXT        = "000000";
// 흰색 — 컬러 헤더 위에 올라가는 텍스트
export const COLOR_TEXT_INVERT = "FFFFFF";

// ─── 폰트 크기 (DOCX 단위: half-point. 22 = 11pt) ─────────
export const SIZE_BODY        = 22; // 11pt 본문
export const SIZE_TABLE_CELL  = 20; // 10pt 표 셀
export const SIZE_HEADING_1   = 32; // 16pt 1차 섹션
export const SIZE_HEADING_2   = 26; // 13pt 2차 섹션
export const SIZE_TITLE_LARGE = 56; // 28pt 표지 제목
export const SIZE_TITLE_MID   = 32; // 16pt 표지 부제
export const SIZE_TITLE_SMALL = 28; // 14pt 표지 프로젝트명
export const SIZE_HEADER_FOOT = 20; // 10pt 머리글
export const SIZE_FOOTER_PAGE = 18; // 9pt  바닥글 페이지번호
export const SIZE_FOOTER_NOTE = 16; // 8pt  바닥글 저작권

// ─── 용지 (DXA 단위: 1440 = 1inch) ────────────────────────
// A4 portrait
export const PAGE_WIDTH  = 11906;
export const PAGE_HEIGHT = 16838;
export const PAGE_MARGIN = 1440; // 1 inch
// 본문 폭 = 용지폭 - 좌우 여백
export const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2; // 9026
