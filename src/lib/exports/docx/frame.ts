/**
 * exports/docx/frame.ts — Word 출력 양식 공통 프레임
 *
 * 역할:
 *   - 머리글(좌: 발주처 / 우: 문서 종류 + 회색 하단선)
 *   - 바닥글(중앙: 페이지번호 / 우측: 저작권)
 *   - 문서 스타일·번호매기기 등 모든 docx 출력에 공통으로 들어가는 설정
 *   - Document 인스턴스 생성을 한 함수(`buildDocument`)로 묶어 호출부를 단순화
 *
 * 사용:
 *   const doc = buildDocument({
 *     ordererName: "한국환경공단",
 *     docKind:     "요구사항 명세서",
 *     copyright:   "Copyright ⓒ ...",
 *     children:    [...표지, ...본문],
 *   });
 *
 * 양식 토큰은 모두 tokens.ts 에서 가져옴 — 여기서 색상·폰트 하드코딩 금지.
 */

import {
  Document, Header, Footer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, HeadingLevel, PageNumber, WidthType,
  type ISectionOptions,
} from "docx";
import {
  FONT,
  COLOR_PRIMARY, COLOR_MUTED,
  SIZE_BODY, SIZE_HEADING_1, SIZE_HEADING_2,
  SIZE_HEADER_FOOT, SIZE_FOOTER_PAGE, SIZE_FOOTER_NOTE,
  CONTENT_WIDTH, PAGE_WIDTH, PAGE_HEIGHT, PAGE_MARGIN,
} from "./tokens";
import { p, noBorders, numberingConfig } from "./helpers";

// ─── 머리글 ───────────────────────────────────────────────
/**
 * 좌: 발주처 (굵게) / 우: 문서 종류 + 회색 하단선 한 줄
 *
 * 자몽컴퍼니 공공 SI 양식 참고: 표 1행 2열 + 회색 하단선 paragraph border.
 * 별도 표는 셀 보더를 다 끄고(noBorders) 좌우 정렬만 활용.
 */
function buildHeader(ordererName: string, docKind: string): Header {
  const halfWidth = CONTENT_WIDTH / 2;
  return new Header({
    children: [
      new Table({
        width: { size: CONTENT_WIDTH, type: WidthType.DXA },
        columnWidths: [halfWidth, halfWidth],
        rows: [
          new TableRow({
            children: [
              new TableCell({
                borders: noBorders,
                width:   { size: halfWidth, type: WidthType.DXA },
                children: [p(ordererName, { size: SIZE_HEADER_FOOT, bold: true, align: AlignmentType.LEFT })],
              }),
              new TableCell({
                borders: noBorders,
                width:   { size: halfWidth, type: WidthType.DXA },
                children: [p(docKind, { size: SIZE_HEADER_FOOT, align: AlignmentType.RIGHT })],
              }),
            ],
          }),
        ],
      }),
      // 회색 하단선 — 빈 paragraph 의 bottom border 로 구현 (1pt 회색)
      new Paragraph({
        border:  { bottom: { style: BorderStyle.SINGLE, size: 12, color: COLOR_MUTED, space: 1 } },
        spacing: { before: 0, after: 0 },
        children: [new TextRun({ text: "" })],
      }),
    ],
  });
}

// ─── 바닥글 ───────────────────────────────────────────────
/**
 * 중앙: 페이지번호 N/M / 우측: 저작권(회색)
 */
function buildFooter(copyright: string): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: SIZE_FOOTER_PAGE }),
          new TextRun({ text: " / ", font: FONT, size: SIZE_FOOTER_PAGE }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: SIZE_FOOTER_PAGE }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing:   { before: 60 },
        children:  [new TextRun({ text: copyright, font: FONT, size: SIZE_FOOTER_NOTE, color: COLOR_MUTED })],
      }),
    ],
  });
}

// ─── 섹션 헤딩 (본문 안에서 쓰는 1차/2차 섹션 헤딩) ─────
/**
 * "1. 요구사항 개요" 같은 1차 섹션 헤딩 — 진청, 굵게.
 * Heading1 스타일을 적용하므로 자동 목차(TOC)에 잡힌다.
 */
export function heading1(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 240 },
    children: [
      new TextRun({ text, font: FONT, size: SIZE_HEADING_1, bold: true, color: COLOR_PRIMARY }),
    ],
  });
}

/**
 * "2.1 요구사항 설명" 같은 2차 섹션 헤딩 — Heading2 스타일.
 */
export function heading2(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 180 },
    children: [
      new TextRun({ text, font: FONT, size: SIZE_HEADING_2, bold: true, color: COLOR_PRIMARY }),
    ],
  });
}

// ─── Document 빌드 ───────────────────────────────────────
type BuildDocumentOptions = {
  /** 머리글 좌측에 표시될 발주처명 (예: "한국환경공단") */
  ordererName: string;
  /** 머리글 우측 + 표지 큰 타이틀로 사용 (예: "요구사항 명세서") */
  docKind: string;
  /** 바닥글 우측 저작권 문구 */
  copyright: string;
  /** 메타데이터(파일 속성) */
  title:       string;
  description: string;
  /** 섹션 본문 — 표지/변경이력/목차/본문 등 모든 children 을 순서대로 */
  children: ISectionOptions["children"];
};

/**
 * 양식 공통 설정이 적용된 Document 인스턴스를 만든다.
 *   - A4 / 1inch 여백
 *   - 머리글: 발주처 / 문서 종류
 *   - 바닥글: 페이지 / 저작권
 *   - Heading1, Heading2 스타일 (TOC 자동 수집용)
 *   - bullets / numbers 번호매기기 정의 등록
 *
 * 호출부(requirement.ts 등)는 children 만 만들면 된다.
 */
export function buildDocument(opts: BuildDocumentOptions): Document {
  return new Document({
    creator:     "SPECODE",
    title:       opts.title,
    description: opts.description,

    // 본문 기본 폰트 + Heading 스타일 (TOC 가 헤딩을 자동 수집하려면 outlineLevel 필수)
    styles: {
      default: { document: { run: { font: FONT, size: SIZE_BODY } } },
      paragraphStyles: [
        {
          id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run:       { size: SIZE_HEADING_1, bold: true, font: FONT, color: COLOR_PRIMARY },
          paragraph: { spacing: { before: 360, after: 240 }, outlineLevel: 0 },
        },
        {
          id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run:       { size: SIZE_HEADING_2, bold: true, font: FONT, color: COLOR_PRIMARY },
          paragraph: { spacing: { before: 300, after: 180 }, outlineLevel: 1 },
        },
      ],
    },

    numbering: { config: numberingConfig },

    sections: [{
      properties: {
        page: {
          size:   { width: PAGE_WIDTH, height: PAGE_HEIGHT },
          margin: { top: PAGE_MARGIN, right: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN },
        },
      },
      headers: { default: buildHeader(opts.ordererName, opts.docKind) },
      footers: { default: buildFooter(opts.copyright) },
      children: opts.children,
    }],
  });
}
