/**
 * exports/docx/helpers.ts — Word 출력 양식 빌딩 블록
 *
 * 역할:
 *   - Paragraph / TableCell 같은 docx 원시 객체를 만들 때 매번 옵션 객체를 다 지정하면
 *     호출부가 너무 장황해지므로 자주 쓰는 패턴을 작은 함수로 묶는다.
 *   - 모든 함수는 인자가 단순(문자열·숫자)하고 반환은 docx 원시 객체 — 추상화 최소.
 *
 * 사용 규칙:
 *   - tokens.ts 의 상수만 사용. 색상/크기 하드코딩 금지.
 *   - 새 양식이 필요하면 새 헬퍼를 추가하지 말고 기존 헬퍼 옵션 확장.
 *
 * 의존:
 *   - docx — 6.x 이상 (TableCell.borders 객체 형태)
 */

import {
  Paragraph, TextRun, TableCell, AlignmentType,
  BorderStyle, WidthType, ShadingType, VerticalAlign, LevelFormat,
} from "docx";
import {
  FONT,
  COLOR_PRIMARY, COLOR_LABEL_BG, COLOR_BORDER,
  COLOR_TEXT_INVERT,
  SIZE_BODY, SIZE_TABLE_CELL,
} from "./tokens";

// ─── 보더 ────────────────────────────────────────────────
// 표 셀 기본 보더 — 옅은 회색 1px
const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER };
export const cellBorders = {
  top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder,
};

// 머리글/바닥글에서 사용하는 무 보더 (보더 없는 표를 만들 때)
const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
export const noBorders = {
  top: noBorder, bottom: noBorder, left: noBorder, right: noBorder,
};

// ─── 문단 ────────────────────────────────────────────────
type ParagraphOptions = {
  size?:    number;
  bold?:    boolean;
  color?:   string;
  align?:   (typeof AlignmentType)[keyof typeof AlignmentType];
  before?:  number; // spacing.before (DXA)
  after?:   number; // spacing.after  (DXA)
  line?:    number; // spacing.line   (DXA)
};

/**
 * 일반 문단 — 본문, 표 셀, 헤더 등 텍스트 한 줄을 만들 때 사용.
 * size·color 등은 모두 토큰값 기반 기본값을 가지므로 호출부는 텍스트만 전달해도 동작.
 */
export function p(text: string, opts: ParagraphOptions = {}): Paragraph {
  return new Paragraph({
    spacing: {
      before: opts.before ?? 60,
      after:  opts.after  ?? 60,
      line:   opts.line   ?? 300,
    },
    alignment: opts.align ?? AlignmentType.LEFT,
    children: [
      new TextRun({
        text,
        font:  FONT,
        size:  opts.size  ?? SIZE_BODY,
        bold:  opts.bold  ?? false,
        color: opts.color,
      }),
    ],
  });
}

// ─── 표 셀 ───────────────────────────────────────────────
/**
 * 라벨 셀 — 회색 배경에 가운데 정렬한 굵은 텍스트.
 * 메타데이터 표 좌측 컬럼에 사용.
 */
export function labelCell(text: string, width: number): TableCell {
  return new TableCell({
    borders: cellBorders,
    width:   { size: width, type: WidthType.DXA },
    shading: { fill: COLOR_LABEL_BG, type: ShadingType.CLEAR },
    margins: { top: 100, bottom: 100, left: 140, right: 140 },
    verticalAlign: VerticalAlign.CENTER,
    children: [p(text, { bold: true, size: SIZE_TABLE_CELL, align: AlignmentType.CENTER })],
  });
}

type ValueCellOptions = {
  columnSpan?: number;
  align?:      (typeof AlignmentType)[keyof typeof AlignmentType];
};

/**
 * 값 셀 — 흰 배경 좌측 정렬. 배열을 넘기면 여러 줄로 표시.
 */
export function valueCell(
  text: string | string[],
  width: number,
  opts: ValueCellOptions = {}
): TableCell {
  const lines = Array.isArray(text) ? text : [text];
  return new TableCell({
    borders: cellBorders,
    width:   { size: width, type: WidthType.DXA },
    margins: { top: 100, bottom: 100, left: 140, right: 140 },
    verticalAlign: VerticalAlign.CENTER,
    columnSpan: opts.columnSpan,
    children: lines.map((line) => p(line, { size: SIZE_TABLE_CELL, align: opts.align })),
  });
}

/**
 * 표 헤더 셀 — 진청 배경 + 흰 글씨. 표 첫 행에 사용.
 */
export function headerCell(text: string, width: number): TableCell {
  return new TableCell({
    borders: cellBorders,
    width:   { size: width, type: WidthType.DXA },
    shading: { fill: COLOR_PRIMARY, type: ShadingType.CLEAR },
    margins: { top: 120, bottom: 120, left: 140, right: 140 },
    verticalAlign: VerticalAlign.CENTER,
    children: [
      p(text, {
        bold:  true,
        size:  SIZE_TABLE_CELL,
        color: COLOR_TEXT_INVERT,
        align: AlignmentType.CENTER,
      }),
    ],
  });
}

// ─── 리스트 ──────────────────────────────────────────────
/**
 * 불릿 항목 (• 텍스트) — 사용 전 numberingConfig 의 "bullets" 레벨이 등록되어 있어야 함.
 */
export function bulletItem(text: string): Paragraph {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing:   { before: 40, after: 40, line: 300 },
    children:  [new TextRun({ text, font: FONT, size: SIZE_BODY })],
  });
}

/**
 * 번호 항목 (1. 2. 3. ...) — 사용 전 numberingConfig 의 "numbers" 레벨이 등록되어 있어야 함.
 */
export function numberedItem(text: string): Paragraph {
  return new Paragraph({
    numbering: { reference: "numbers", level: 0 },
    spacing:   { before: 40, after: 40, line: 300 },
    children:  [new TextRun({ text, font: FONT, size: SIZE_BODY })],
  });
}

// ─── numbering 정의 ─────────────────────────────────────
/**
 * Document 생성 시 numbering.config 에 그대로 넣을 수 있는 기본 정의.
 * bullets / numbers 두 reference 를 등록한다.
 */
export const numberingConfig = [
  {
    reference: "bullets",
    levels: [{
      level: 0,
      format: LevelFormat.BULLET,
      text: "•",
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720, hanging: 360 } } },
    }],
  },
  {
    reference: "numbers",
    levels: [{
      level: 0,
      format: LevelFormat.DECIMAL,
      text: "%1.",
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720, hanging: 360 } } },
    }],
  },
];
