/**
 * exports/docx/requirement.ts — 요구사항 명세서 docx 빌더
 *
 * 역할:
 *   - 요구사항 1건의 데이터(`RequirementExportInput`)를 받아
 *     공공 SI 양식의 Word 문서를 만들어 Buffer 로 돌려준다
 *   - 양식 구조: 표지 → 변경이력 → 목차 → 본문(개요/상세 명세)
 *
 * 책임 분리:
 *   - 데이터 매핑(DB → RequirementExportInput): API route 가 담당
 *   - 양식 토큰: tokens.ts
 *   - 빌딩 블록: helpers.ts (셀, 문단, 리스트)
 *   - 문서 프레임: frame.ts (머리글/바닥글/Document)
 *   - 이 파일: 요구사항 양식의 "구성"만 책임
 *
 * 추후 확장:
 *   - 단위업무, 화면, 기능 등 다른 도메인 출력은 같은 폴더에 새 파일을 추가
 *     (예: unit-work.ts, screen.ts) — 이 파일을 그대로 본떠 작성
 *   - PDF 변환은 이 함수의 결과 Buffer 를 받아 LibreOffice 등으로 변환
 */

import {
  Packer, Paragraph, Table, TableRow, TextRun, PageBreak, TableOfContents,
  AlignmentType, WidthType,
} from "docx";
import {
  COLOR_PRIMARY,
  SIZE_TITLE_LARGE, SIZE_TITLE_MID, SIZE_TITLE_SMALL,
  SIZE_HEADING_1,
  CONTENT_WIDTH,
} from "./tokens";
import { p, labelCell, valueCell, headerCell, bulletItem, numberedItem } from "./helpers";
import { buildDocument, heading1, heading2 } from "./frame";

// ─── 입력 타입 ────────────────────────────────────────────
/**
 * Word 출력 시 필요한 모든 데이터.
 *
 * DB 정비 전이라도 호출부(API route)에서 fallback 값을 채워서 넘기면 양식은 그대로 동작.
 * 모든 필드는 호출부 책임 — 이 모듈에서는 비어 있어도 깨지지 않게만 처리.
 */
export type RequirementExportInput = {
  // ── 발주처/문서 메타 ────────────────────────────
  ordererName: string;     // 머리글 좌측 (예: "한국환경공단")
  copyright:   string;     // 바닥글 우측 (예: "Copyright ⓒ ...")

  // ── 프로젝트 ───────────────────────────────────
  projectName: string;     // 표지 상단 (예: "SPECODE 프로젝트")

  // ── 요구사항 본체 ──────────────────────────────
  reqDisplayId:    string; // 표시 ID (예: "REQ-00023")
  reqName:         string; // 요구사항명
  parentTaskName:  string; // 상위 과업명
  priorityLabel:   string; // 우선순위 라벨 (예: "낮음 (LOW)")
  sourceLabel:     string; // 출처 라벨 (예: "RFP")
  rfpPage:         string; // RFP 페이지 (없으면 "-")
  assigneeName:    string; // 담당자명 (없으면 "미지정")
  sortOrder:       number; // 정렬 순서
  detailSpec:      string; // 상세 명세 (마크다운 가능, 빈 문자열이면 섹션 생략)

  // ── 표지 작성정보 ──────────────────────────────
  documentVersion: string; // (예: "v1.0")
  writtenAt:       string; // (예: "2026-04-26")
  authorName:      string; // 작성자명
  approverName:    string; // 승인자명

  // ── 변경 이력 ──────────────────────────────────
  // 최신이 위. 빈 배열이면 표 헤더만 표시.
  history: Array<{
    version:  string;
    date:     string;
    change:   string;
    author:   string;
    approver: string;
  }>;
};

// ─── 상세 명세 마크다운 파싱 ──────────────────────────────
// 호출부에서 그대로 마크다운을 넘겨도 양식이 그럴듯하게 보이도록 가벼운 파싱.
// 정식 마크다운 파서를 쓰지 않는 이유: 헤더/리스트/표만 잡으면 충분하고, 의존성 부담 회피.
//
// 인식하는 블록:
//   - ###/##/# 헤딩
//   - "- " 또는 "* " 불릿
//   - "1. " 또는 "1) " 번호 항목
//   - "| col | col |" 형태의 GFM 표 (헤더 + 구분선 + 데이터)
//   - 그 외 일반 문단
type SpecBlock =
  | { kind: "heading"; text: string }
  | { kind: "bullet";  text: string }
  | { kind: "number";  text: string }
  | { kind: "plain";   text: string }
  | { kind: "table";   header: string[]; rows: string[][] };

// "|----|---|" 같은 GFM 표 구분선 판정 — `-` 가 적어도 1개 있고, 셀 내용이 -, :, 공백, | 로만 구성.
function isTableSeparator(line: string): boolean {
  return /^\|[\s\-:|]+\|$/.test(line) && line.includes("-");
}

// "| a | b | c |" → ["a", "b", "c"]  (앞뒤 | 제거 후 split)
function splitTableRow(line: string): string[] {
  return line.slice(1, -1).split("|").map((c) => c.trim());
}

// 라인이 표 행 형태인지 — 양 끝이 | 이고 내부에 | 가 있어야 함 (즉 셀이 2개 이상)
function looksLikeTableRow(line: string): boolean {
  return line.startsWith("|") && line.endsWith("|") && line.length > 2 && line.includes("|", 1);
}

function parseSpec(markdown: string): SpecBlock[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: SpecBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // 빈 줄 — 블록 구분자, 출력엔 영향 없음
    if (!line) { i++; continue; }

    // ── 표 인식 (헤더 + 구분선이 연속해야 표로 인정) ──────────
    if (looksLikeTableRow(line) && isTableSeparator((lines[i + 1] ?? "").trim())) {
      const header = splitTableRow(line);
      const rows: string[][] = [];
      i += 2; // 헤더, 구분선 건너뛰기
      while (i < lines.length) {
        const t = lines[i].trim();
        if (!looksLikeTableRow(t)) break;
        const cells = splitTableRow(t);
        // 셀 수가 헤더와 다르면 헤더 길이에 맞춰 채우거나 자른다
        while (cells.length < header.length) cells.push("");
        rows.push(cells.slice(0, header.length));
        i++;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    // ── 단일 라인 블록들 ─────────────────────────────────────
    if (line.startsWith("### ")) blocks.push({ kind: "heading", text: line.slice(4) });
    else if (line.startsWith("## "))  blocks.push({ kind: "heading", text: line.slice(3) });
    else if (line.startsWith("# "))   blocks.push({ kind: "heading", text: line.slice(2) });
    else if (/^[-*]\s+/.test(line))   blocks.push({ kind: "bullet", text: line.replace(/^[-*]\s+/, "") });
    else if (/^\d+[.)]\s+/.test(line)) blocks.push({ kind: "number", text: line.replace(/^\d+[.)]\s+/, "") });
    else blocks.push({ kind: "plain", text: line });

    i++;
  }
  return blocks;
}

// 마크다운 표 → docx Table.
// 컬럼 폭은 균등 분할. 마지막 컬럼이 자투리(나머지)를 흡수해 합계가 CONTENT_WIDTH 와 정확히 일치.
function buildSpecTable(header: string[], rows: string[][]): Table {
  const colCount = header.length;
  const baseW = Math.floor(CONTENT_WIDTH / colCount);
  const widths = header.map((_, i) =>
    i === colCount - 1 ? CONTENT_WIDTH - baseW * (colCount - 1) : baseW
  );

  return new Table({
    width:        { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({
        tableHeader: true,
        children: header.map((h, i) => headerCell(h, widths[i])),
      }),
      ...rows.map((r) => new TableRow({
        children: r.map((cell, i) => valueCell(cell, widths[i])),
      })),
    ],
  });
}

/**
 * 파싱된 spec 블록들을 docx 요소들(문단/표)로 변환.
 * 헤딩은 "2.1, 2.2 ..." 자동 번호로 heading2 스타일.
 */
function renderSpec(spec: string): (Paragraph | Table)[] {
  if (!spec.trim()) return [p("(상세 명세가 작성되지 않았습니다.)", { color: "808080" })];

  const blocks = parseSpec(spec);
  const result: (Paragraph | Table)[] = [];
  let subIdx = 0;

  for (const b of blocks) {
    switch (b.kind) {
      case "heading":
        subIdx++;
        result.push(heading2(`2.${subIdx} ${b.text}`));
        break;
      case "bullet":
        result.push(bulletItem(b.text));
        break;
      case "number":
        result.push(numberedItem(b.text));
        break;
      case "plain":
        result.push(p(b.text));
        break;
      case "table":
        result.push(buildSpecTable(b.header, b.rows));
        break;
    }
  }
  return result;
}

// ─── 표지 ────────────────────────────────────────────────
function buildCover(input: RequirementExportInput, docKind: string): (Paragraph | Table)[] {
  // 표지 상단 여백
  const blank = (size: number) => new Paragraph({ spacing: { before: size }, children: [new TextRun("")] });

  // 작성정보 표 (작성일/문서버전/작성자/승인자)
  const COVER_LABEL_W = 1800;
  const COVER_VALUE_W = 3600;
  const coverInfoTable = new Table({
    width:        { size: COVER_LABEL_W + COVER_VALUE_W, type: WidthType.DXA },
    columnWidths: [COVER_LABEL_W, COVER_VALUE_W],
    alignment:    AlignmentType.CENTER,
    rows: [
      new TableRow({ children: [labelCell("작성일",   COVER_LABEL_W), valueCell(input.writtenAt,       COVER_VALUE_W)] }),
      new TableRow({ children: [labelCell("문서 버전", COVER_LABEL_W), valueCell(input.documentVersion, COVER_VALUE_W)] }),
      new TableRow({ children: [labelCell("작성자",   COVER_LABEL_W), valueCell(input.authorName,      COVER_VALUE_W)] }),
      new TableRow({ children: [labelCell("승인자",   COVER_LABEL_W), valueCell(input.approverName,    COVER_VALUE_W)] }),
    ],
  });

  return [
    blank(2000),
    // 프로젝트명
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing:   { before: 0, after: 200 },
      children:  [new TextRun({ text: input.projectName, font: "맑은 고딕", size: SIZE_TITLE_SMALL, bold: true })],
    }),
    // 큰 타이틀
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing:   { before: 0, after: 1200 },
      children:  [new TextRun({ text: docKind, font: "맑은 고딕", size: SIZE_TITLE_LARGE, bold: true, color: COLOR_PRIMARY })],
    }),
    // 요구사항 ID
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing:   { before: 0, after: 100 },
      children:  [new TextRun({ text: input.reqDisplayId, font: "맑은 고딕", size: SIZE_TITLE_MID, bold: true })],
    }),
    // 요구사항명
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing:   { before: 0, after: 2000 },
      children:  [new TextRun({ text: input.reqName, font: "맑은 고딕", size: SIZE_TITLE_MID })],
    }),
    coverInfoTable,
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

// ─── 변경 이력 페이지 ────────────────────────────────────
function buildHistory(input: RequirementExportInput): (Paragraph | Table)[] {
  // 컬럼: 버전 / 작성일 / 변경 내용 / 작성자 / 승인자 (sum = CONTENT_WIDTH)
  const W = [1100, 1500, CONTENT_WIDTH - 1100 - 1500 - 1500 - 1500, 1500, 1500];

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headerCell("버전",      W[0]),
      headerCell("작성일",    W[1]),
      headerCell("변경 내용", W[2]),
      headerCell("작성자",    W[3]),
      headerCell("승인자",    W[4]),
    ],
  });

  const dataRows = input.history.length === 0
    ? [
        new TableRow({
          children: [
            valueCell("(이력 없음)", W[0] + W[1] + W[2] + W[3] + W[4], {
              columnSpan: 5,
              align:      AlignmentType.CENTER,
            }),
          ],
        }),
      ]
    : input.history.map((h) => new TableRow({
        children: [
          valueCell(h.version,  W[0], { align: AlignmentType.CENTER }),
          valueCell(h.date,     W[1], { align: AlignmentType.CENTER }),
          valueCell(h.change,   W[2]),
          valueCell(h.author,   W[3], { align: AlignmentType.CENTER }),
          valueCell(h.approver, W[4], { align: AlignmentType.CENTER }),
        ],
      }));

  return [
    new Paragraph({
      spacing: { before: 0, after: 240 },
      children: [
        new TextRun({ text: "변경 이력", font: "맑은 고딕", size: SIZE_HEADING_1, bold: true, color: COLOR_PRIMARY }),
      ],
    }),
    p("본 문서의 작성·검토·승인 이력은 다음과 같습니다.", { after: 200 }),
    new Table({
      width:        { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: W,
      rows:         [headerRow, ...dataRows],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

// ─── 목차 페이지 ─────────────────────────────────────────
// Word 가 Heading1, Heading2 를 자동 수집. 사용자는 문서 열고 F9 로 갱신.
function buildToc(): (Paragraph | TableOfContents)[] {
  return [
    new Paragraph({
      spacing: { before: 0, after: 240 },
      children: [
        new TextRun({ text: "목차", font: "맑은 고딕", size: SIZE_HEADING_1, bold: true, color: COLOR_PRIMARY }),
      ],
    }),
    new TableOfContents("목차", {
      hyperlink:         true,
      headingStyleRange: "1-2",
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

// ─── 본문 (1. 개요 / 2. 상세 명세) ───────────────────────
function buildBody(input: RequirementExportInput): (Paragraph | Table)[] {
  // 메타데이터 표 — 4컬럼 (라벨 / 값 / 라벨 / 값)
  const META_LABEL_W = 1700;
  const META_VALUE_W = (CONTENT_WIDTH - META_LABEL_W * 2) / 2;
  const W4 = [META_LABEL_W, META_VALUE_W, META_LABEL_W, META_VALUE_W];

  const metaTable = new Table({
    width:        { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: W4,
    rows: [
      new TableRow({
        children: [
          labelCell("요구사항 ID", W4[0]), valueCell(input.reqDisplayId,    W4[1]),
          labelCell("요구사항명",  W4[2]), valueCell(input.reqName,         W4[3]),
        ],
      }),
      new TableRow({
        children: [
          labelCell("상위 과업",   W4[0]), valueCell(input.parentTaskName,  W4[1]),
          labelCell("출처",       W4[2]), valueCell(input.sourceLabel,     W4[3]),
        ],
      }),
      new TableRow({
        children: [
          labelCell("우선순위",   W4[0]), valueCell(input.priorityLabel,   W4[1]),
          labelCell("RFP 페이지", W4[2]), valueCell(input.rfpPage || "-",  W4[3]),
        ],
      }),
      new TableRow({
        children: [
          labelCell("담당자",     W4[0]), valueCell(input.assigneeName,    W4[1]),
          labelCell("정렬 순서",  W4[2]), valueCell(String(input.sortOrder), W4[3]),
        ],
      }),
    ],
  });

  return [
    heading1("1. 요구사항 개요"),
    metaTable,

    heading1("2. 상세 명세"),
    ...renderSpec(input.detailSpec),
  ];
}

// ─── 메인 ────────────────────────────────────────────────
const DOC_KIND = "요구사항 명세서";

/**
 * 요구사항 1건의 docx 파일 Buffer 를 만든다.
 *
 * @param input  DB → 양식 데이터로 매핑된 입력 객체
 * @returns      Buffer (NextResponse 본문으로 그대로 사용 가능)
 */
export async function buildRequirementDocx(input: RequirementExportInput): Promise<Buffer> {
  const doc = buildDocument({
    ordererName: input.ordererName,
    docKind:     DOC_KIND,
    copyright:   input.copyright,
    title:       `${input.reqDisplayId} ${DOC_KIND}`,
    description: `${input.reqDisplayId} ${input.reqName} - ${input.ordererName}`,
    children: [
      ...buildCover(input, DOC_KIND),
      ...buildHistory(input),
      ...buildToc(),
      ...buildBody(input),
    ],
  });

  return Packer.toBuffer(doc);
}
