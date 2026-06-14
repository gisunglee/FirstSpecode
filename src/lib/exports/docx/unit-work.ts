/**
 * exports/docx/unit-work.ts — 프로그램 사양서(단위업무 단위) docx 빌더
 *
 * 역할:
 *   - 단위업무 1건과 그 하위 트리(화면 → 영역 → 기능 + 컬럼 매핑) 데이터를
 *     공공 SI 양식의 표지/변경이력/목차 + SPECODE 도메인을 충실히 풀어쓰는
 *     본문으로 묶어 Word 파일 Buffer 로 돌려준다.
 *
 * 양식 방침:
 *   - 표지 / 변경이력 / 목차 = 한국 SI 양식 패턴 (요구사항 명세서와 일관)
 *   - 본문 = SPECODE 데이터 위주 — 빈 표·placeholder 없이 실제 정보만 출력
 *
 * 본문 구조:
 *   1. 단위업무 정보 (메타 표 + 설명 마크다운)
 *   2. 화면 목록 (요약 표 — 한눈에)
 *   3. 화면별 상세
 *      3.X 화면 (메타 + 설명)
 *        3.X.Y 영역 (메타 + 설명 + 영역 직접 매핑 + 기능들)
 *          기능 (메타 + 설명 + 기능 컬럼 매핑)
 *
 * 책임 분리:
 *   - 데이터 매핑(DB → UnitWorkExportInput): unit-work-data.ts
 *   - 양식 토큰: tokens.ts
 *   - 빌딩 블록: helpers.ts
 *   - 문서 프레임: frame.ts
 *   - 이 파일: 양식 "구성"만
 */

import {
  Packer, Paragraph, Table, TableRow, TextRun, PageBreak, TableOfContents,
  AlignmentType, WidthType,
} from "docx";
import {
  COLOR_PRIMARY,
  SIZE_TITLE_LARGE, SIZE_TITLE_MID,
  SIZE_HEADING_1, SIZE_BODY,
  CONTENT_WIDTH,
} from "./tokens";
import { p, labelCell, valueCell, headerCell, projectTitleRuns, buildCoverMetaTable } from "./helpers";
import { buildDocument, heading1, heading2 } from "./frame";
import { renderMarkdown } from "./markdown";
import { shrinkDocxFonts } from "./shrink-fonts";
import { docMetaCoverRows, type ResolvedDocMeta } from "@/lib/exports/doc-meta";

// ═══════════════════════════════════════════════════════════════════════════
//  입력 타입
// ═══════════════════════════════════════════════════════════════════════════

/** 컬럼 매핑 표의 한 행 — 영역/기능에 매핑된 1컬럼. */
export type ColMappingRow = {
  no:            number;
  itemName:      string; // 사용 목적 또는 컬럼 한글명
  io:            string; // I / O / I/O
  uiType:        string; // UI 타입 (Text/Sbox/Check/Btn 등)
  colLogical:    string; // 컬럼 한글명
  colPhysical:   string; // 컬럼 물리명
  tableLogical:  string; // 테이블 한글명
  tablePhysical: string; // 테이블 물리명
};

/** 영역 하위 기능 1건 — 메타 + 설명 + 기능별 매핑. */
export type FunctionItem = {
  displayId:   string; // FID-XXXXX
  name:        string;
  description: string; // 마크다운
  funcType:    string; // 한글 라벨
  priority:    string; // 한글 라벨
  complexity:  string; // 한글 라벨
  effort:      string; // 공수 (자유 텍스트)
  assigneeName: string; // 담당자명 ("미지정" fallback)
  mappings:    ColMappingRow[];
};

/** 화면 내 영역 1건 — 메타 + 설명 + (영역 직접 매핑) + 기능 목록. */
export type AreaSection = {
  displayId:        string; // AR-XXXXX
  name:             string;
  description:      string; // 마크다운
  areaType:         string; // 한글 라벨
  displayForm:      string; // 한글 라벨
  /** 영역 자체에 매핑된 컬럼 (ref_ty_code='AREA'). 비면 표 출력 생략. */
  directMappings:   ColMappingRow[];
  functions:        FunctionItem[];
};

/** 단위업무 하위 화면 1건 — 메타 + 설명 + 영역 목록. */
export type ScreenSection = {
  displayId:    string; // PID-XXXXX
  name:         string;
  description:  string; // 마크다운
  screenType:   string; // 한글 라벨
  urlPath:      string;
  category:     string; // 카테고리 L > M > S 합쳐서
  assigneeName: string; // 담당자명
  areas:        AreaSection[];
};

/** "2. 화면 목록" 요약 표의 한 행. */
export type ScreenSummaryRow = {
  no:         number;
  displayId:  string;
  name:       string;
  screenType: string;
  areaCount:  number;
  funcCount:  number;
};

/**
 * 프로그램 사양서 docx 빌드에 필요한 모든 데이터.
 *
 * DB 정비 전이라도 호출부(API route)에서 fallback 값을 채워서 넘기면 양식은 그대로 동작.
 * 모든 필드는 호출부 책임 — 이 모듈에서는 비어 있어도 깨지지 않게만 처리.
 */
export type UnitWorkExportInput = {
  // ── 발주처/문서 메타 ────────────────────────────
  ordererName: string;
  copyright:   string;

  // ── 프로젝트 ───────────────────────────────────
  projectName: string;
  // 프로젝트 약어 — 표지의 프로젝트명 옆에 "[ABBR]" 식으로 표시.
  // null/undefined 면 칩 자체를 생략 (약어 미설정 프로젝트 호환).
  projectAbbr?: string | null;

  // ── 단위업무 메타 ──────────────────────────────
  unitWorkDisplayId:   string; // UW-XXXXX
  unitWorkName:        string;
  unitWorkDescription: string; // 마크다운
  parentRequirement:   string; // "REQ-XXXXX 요구사항명"  (없으면 "-")
  assigneeName:        string; // "미지정" fallback
  startDate:           string; // YYYY-MM-DD 또는 "-"
  endDate:             string;
  progressRate:        number; // 0-100
  sortOrder:           number;

  // ── 트리 ─────────────────────────────────────
  screens:        ScreenSection[];
  screenSummary:  ScreenSummaryRow[]; // = screens 에서 파생되지만 빌더 단순화 위해 미리 만들어 받음

  // ── 작성정보 (변경이력 표 + 발행 시스템이 사용) ──
  // 표지엔 미표시(변경이력에만). documentVersion/authorName/approverName 은 발행/이력 시스템도 사용.
  documentVersion: string;
  writtenAt:       string;
  authorName:      string;
  approverName:    string;

  // ── 문서 메타/번호 (시스템명·단계·활동·작업·문서번호) ──
  docMeta: ResolvedDocMeta;

  // ── 변경 이력 ──────────────────────────────────
  history: Array<{
    version:  string;
    date:     string;
    change:   string;
    author:   string;
    approver: string;
  }>;
};

// ═══════════════════════════════════════════════════════════════════════════
//  마크다운 렌더링 — 단위업무 본문은 이미 1/2/3 큰 섹션 헤딩이 있으므로
//  내부 마크다운 헤딩은 자동번호 X (markdown.ts 기본 동작 그대로 사용).
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
//  표지 / 변경이력 / 목차 — 요구사항 빌더와 일관된 형태 (양식 통일)
// ═══════════════════════════════════════════════════════════════════════════

function buildCover(input: UnitWorkExportInput, docKind: string): (Paragraph | Table)[] {
  const blank = (size: number) =>
    new Paragraph({ spacing: { before: size }, children: [new TextRun("")] });

  // 표지 메타표 — 시스템명/단계/활동/작업 + 문서번호 (다른 산출물과 동일 컨셉).
  // 작성일/문서버전/작성자/승인자는 변경이력 표에 있어 표지에선 생략 (중복 제거).
  const COVER_LABEL_W = 1800;
  const COVER_VALUE_W = 3600;
  const coverInfoTable = buildCoverMetaTable(
    docMetaCoverRows(input.docMeta, { includeDocNo: true }),
    COVER_LABEL_W,
    COVER_VALUE_W,
  );

  return [
    blank(2000),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing:   { before: 0, after: 200 },
      children:  projectTitleRuns(input.projectName, input.projectAbbr),
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing:   { before: 0, after: 400 },
      children:  [new TextRun({ text: docKind, font: "맑은 고딕", size: SIZE_TITLE_LARGE, bold: true, color: COLOR_PRIMARY })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing:   { before: 0, after: 1200 },
      children:  [new TextRun({ text: `(${input.unitWorkName})`, font: "맑은 고딕", size: SIZE_TITLE_MID, bold: true, color: COLOR_PRIMARY })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing:   { before: 0, after: 100 },
      children:  [new TextRun({ text: input.unitWorkDisplayId, font: "맑은 고딕", size: SIZE_TITLE_MID, bold: true })],
    }),
    blank(1600),
    coverInfoTable,
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function buildHistory(input: UnitWorkExportInput): (Paragraph | Table)[] {
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
              columnSpan: 5, align: AlignmentType.CENTER,
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

// ═══════════════════════════════════════════════════════════════════════════
//  본문 1 — 단위업무 정보
// ═══════════════════════════════════════════════════════════════════════════

function buildUnitWorkSection(input: UnitWorkExportInput): (Paragraph | Table)[] {
  const META_LABEL_W = 1700;
  const META_VALUE_W = (CONTENT_WIDTH - META_LABEL_W * 2) / 2;
  const W4 = [META_LABEL_W, META_VALUE_W, META_LABEL_W, META_VALUE_W];

  // 4컬럼 (라벨 / 값 / 라벨 / 값) 메타 표
  const metaTable = new Table({
    width:        { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: W4,
    rows: [
      new TableRow({
        children: [
          labelCell("단위업무 ID", W4[0]), valueCell(input.unitWorkDisplayId, W4[1]),
          labelCell("단위업무명",  W4[2]), valueCell(input.unitWorkName,      W4[3]),
        ],
      }),
      new TableRow({
        children: [
          labelCell("상위 요구사항", W4[0]),
          // 요구사항 셀은 폭이 좁으면 줄바꿈 어색 → 한 셀에 2칸 폭 사용
          valueCell(input.parentRequirement, W4[1] + META_LABEL_W + W4[3], { columnSpan: 3 }),
        ],
      }),
      new TableRow({
        children: [
          labelCell("담당자",     W4[0]), valueCell(input.assigneeName, W4[1]),
          labelCell("진행률",     W4[2]), valueCell(`${input.progressRate}%`, W4[3]),
        ],
      }),
      new TableRow({
        children: [
          labelCell("시작일",    W4[0]), valueCell(input.startDate, W4[1]),
          labelCell("종료일",    W4[2]), valueCell(input.endDate,   W4[3]),
        ],
      }),
    ],
  });

  return [
    heading1("1. 단위업무 정보"),
    metaTable,
    // 설명 (마크다운)
    heading2("1.1 단위업무 설명"),
    ...renderMarkdown(input.unitWorkDescription, { emptyText: "(설명이 작성되지 않았습니다.)" }),
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
//  본문 2 — 화면 목록 (요약 표)
// ═══════════════════════════════════════════════════════════════════════════

function buildScreenSummary(input: UnitWorkExportInput): (Paragraph | Table)[] {
  if (input.screenSummary.length === 0) {
    return [
      heading1("2. 화면 목록"),
      p("(화면이 등록되지 않았습니다.)", { color: "808080" }),
    ];
  }

  // 컬럼 폭 — 화면명에 가장 많이, 나머지는 좁게
  const W_NO   = 600;
  const W_ID   = 1300;
  const W_TY   = 1100;
  const W_CNT  = 800;
  const W_NM   = CONTENT_WIDTH - W_NO - W_ID - W_TY - W_CNT * 2;
  const W = [W_NO, W_ID, W_NM, W_TY, W_CNT, W_CNT];

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headerCell("No",       W[0]),
      headerCell("화면 ID",  W[1]),
      headerCell("화면명",   W[2]),
      headerCell("화면 유형", W[3]),
      headerCell("영역 수",  W[4]),
      headerCell("기능 수",  W[5]),
    ],
  });

  const rows = input.screenSummary.map((s) => new TableRow({
    children: [
      valueCell(String(s.no),         W[0], { align: AlignmentType.CENTER }),
      valueCell(s.displayId,           W[1], { align: AlignmentType.CENTER }),
      valueCell(s.name,                W[2]),
      valueCell(s.screenType || "-",   W[3], { align: AlignmentType.CENTER }),
      valueCell(String(s.areaCount),   W[4], { align: AlignmentType.CENTER }),
      valueCell(String(s.funcCount),   W[5], { align: AlignmentType.CENTER }),
    ],
  }));

  return [
    heading1("2. 화면 목록"),
    new Table({
      width:        { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: W,
      rows:         [headerRow, ...rows],
    }),
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
//  컬럼 매핑 표 (영역 직접 + 기능별 공통)
// ═══════════════════════════════════════════════════════════════════════════

function buildMappingTable(rows: ColMappingRow[]): Table {
  // 컬럼 폭 — 7컬럼 (데이터타입 제거 후 폭 재배분).
  // 항목명·엔터티·속성·컬럼명에 충분한 가로폭 → 줄바꿈 최소화.
  // W_UI 950 — 헤더 "UI 타입" 4글자가 한 줄에 들어가도록 (이전 800은 줄바꿈 발생)
  const W_NO  = 500;
  const W_IO  = 500;
  const W_UI  = 950;
  const REST  = CONTENT_WIDTH - W_NO - W_IO - W_UI; // 항목명/엔터티/속성/컬럼명 4칸
  const W_NM  = Math.floor(REST * 0.28);
  const W_ENT = Math.floor(REST * 0.22);
  const W_ATT = Math.floor(REST * 0.22);
  const W_COL = REST - W_NM - W_ENT - W_ATT;        // 마지막이 자투리 흡수
  const W = [W_NO, W_NM, W_IO, W_UI, W_ENT, W_ATT, W_COL];

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headerCell("No",      W[0]),
      headerCell("항목명",  W[1]),
      headerCell("I/O",     W[2]),
      headerCell("UI 타입", W[3]),
      headerCell("엔터티",  W[4]),
      headerCell("속성",    W[5]),
      headerCell("컬럼명",  W[6]),
    ],
  });

  const dataRows = rows.map((m) => new TableRow({
    children: [
      valueCell(String(m.no),   W[0], { align: AlignmentType.CENTER }),
      valueCell(m.itemName,     W[1]),
      valueCell(m.io,           W[2], { align: AlignmentType.CENTER }),
      valueCell(m.uiType,       W[3], { align: AlignmentType.CENTER }),
      valueCell(m.tableLogical, W[4]),
      valueCell(m.colLogical,   W[5]),
      valueCell(m.colPhysical,  W[6]),
    ],
  }));

  return new Table({
    width:        { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: W,
    rows:         [headerRow, ...dataRows],
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  기능 1건 (메타 + 설명 + 매핑)
// ═══════════════════════════════════════════════════════════════════════════

function buildFunctionBlock(fn: FunctionItem, indexLabel: string): (Paragraph | Table)[] {
  // "3.1.2.1 [FID-XXXXX] 기능명" 같은 헤더 — heading 보다 작은 4단계 굵은 문단
  const head = new Paragraph({
    spacing: { before: 240, after: 120 },
    children: [
      new TextRun({
        text:  `${indexLabel} [${fn.displayId}] ${fn.name || "(기능명 미지정)"}`,
        font:  "맑은 고딕",
        size:  SIZE_BODY,
        bold:  true,
        color: COLOR_PRIMARY,
      }),
    ],
  });

  // 메타 표 (1행 4셀: 유형/우선순위/복잡도/공수, 1행 2셀: 담당자)
  const META_LABEL_W = 1300;
  const META_VALUE_W = (CONTENT_WIDTH - META_LABEL_W * 4) / 4;
  const W = [META_LABEL_W, META_VALUE_W, META_LABEL_W, META_VALUE_W];

  const metaTable = new Table({
    width:        { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [W[0], W[1], W[2], W[3], META_LABEL_W, META_VALUE_W, META_LABEL_W, META_VALUE_W],
    rows: [
      new TableRow({
        children: [
          labelCell("유형",     W[0]), valueCell(fn.funcType   || "-", W[1]),
          labelCell("우선순위", W[2]), valueCell(fn.priority   || "-", W[3]),
          labelCell("복잡도",   W[0]), valueCell(fn.complexity || "-", W[1]),
          labelCell("공수",     W[2]), valueCell(fn.effort     || "-", W[3]),
        ],
      }),
      new TableRow({
        children: [
          labelCell("담당자", W[0]),
          valueCell(fn.assigneeName, W[1] + META_LABEL_W + W[3] + META_LABEL_W + W[1] + META_LABEL_W + W[3], { columnSpan: 7 }),
        ],
      }),
    ],
  });

  const blocks: (Paragraph | Table)[] = [head, metaTable];

  // 설명
  if (fn.description?.trim()) {
    blocks.push(...renderMarkdown(fn.description));
  }

  // 컬럼 매핑 (있으면)
  if (fn.mappings.length > 0) {
    blocks.push(p("컬럼 매핑", { bold: true, before: 160, after: 80 }));
    blocks.push(buildMappingTable(fn.mappings));
  }

  return blocks;
}

// ═══════════════════════════════════════════════════════════════════════════
//  영역 1건 (메타 + 설명 + 영역 직접 매핑 + 기능 목록)
// ═══════════════════════════════════════════════════════════════════════════

function buildAreaBlock(area: AreaSection, indexLabel: string): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [];

  // "3.1.1 [AR-XXXXX] 영역명" — heading2 (TOC 자동수집)
  blocks.push(heading2(`${indexLabel} [${area.displayId}] ${area.name || "(영역명 미지정)"}`));

  // 메타 표 (4컬럼)
  const META_LABEL_W = 1500;
  const META_VALUE_W = (CONTENT_WIDTH - META_LABEL_W * 2) / 2;
  const W4 = [META_LABEL_W, META_VALUE_W, META_LABEL_W, META_VALUE_W];

  blocks.push(new Table({
    width:        { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: W4,
    rows: [
      new TableRow({
        children: [
          labelCell("영역 유형",  W4[0]), valueCell(area.areaType    || "-", W4[1]),
          labelCell("표시 형태",  W4[2]), valueCell(area.displayForm || "-", W4[3]),
        ],
      }),
    ],
  }));

  // 설명
  if (area.description?.trim()) {
    blocks.push(...renderMarkdown(area.description));
  }

  // 영역 직접 매핑 (있으면)
  if (area.directMappings.length > 0) {
    blocks.push(p("영역 직접 매핑", { bold: true, before: 200, after: 80 }));
    blocks.push(buildMappingTable(area.directMappings));
  }

  // 기능 목록
  if (area.functions.length > 0) {
    blocks.push(p(`기능 (${area.functions.length}건)`, { bold: true, before: 240, after: 80 }));
    area.functions.forEach((fn, i) => {
      const fnLabel = `${indexLabel}.${i + 1}`;
      blocks.push(...buildFunctionBlock(fn, fnLabel));
    });
  } else if (area.directMappings.length === 0) {
    // 매핑도 없고 기능도 없는 영역 — 안내
    blocks.push(p("(이 영역에 등록된 기능 / 매핑이 없습니다.)", { color: "808080", before: 100 }));
  }

  return blocks;
}

// ═══════════════════════════════════════════════════════════════════════════
//  화면 1건 (메타 + 설명 + 영역 목록)
// ═══════════════════════════════════════════════════════════════════════════

function buildScreenBlock(screen: ScreenSection, screenNo: number): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [];

  // "3.X [PID-XXXXX] 화면명" — heading2
  blocks.push(heading2(`3.${screenNo} [${screen.displayId}] ${screen.name || "(화면명 미지정)"}`));

  // 메타 표 (2행 4셀)
  const META_LABEL_W = 1500;
  const META_VALUE_W = (CONTENT_WIDTH - META_LABEL_W * 2) / 2;
  const W4 = [META_LABEL_W, META_VALUE_W, META_LABEL_W, META_VALUE_W];

  blocks.push(new Table({
    width:        { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: W4,
    rows: [
      new TableRow({
        children: [
          labelCell("화면 유형", W4[0]), valueCell(screen.screenType || "-", W4[1]),
          labelCell("URL 경로", W4[2]), valueCell(screen.urlPath    || "-", W4[3]),
        ],
      }),
      new TableRow({
        children: [
          labelCell("카테고리",  W4[0]), valueCell(screen.category    || "-", W4[1]),
          labelCell("담당자",    W4[2]), valueCell(screen.assigneeName,       W4[3]),
        ],
      }),
    ],
  }));

  // 설명
  if (screen.description?.trim()) {
    blocks.push(...renderMarkdown(screen.description));
  }

  // 영역 목록
  if (screen.areas.length === 0) {
    blocks.push(p("(이 화면에 등록된 영역이 없습니다.)", { color: "808080", before: 200 }));
  } else {
    screen.areas.forEach((area, ai) => {
      const areaLabel = `3.${screenNo}.${ai + 1}`;
      blocks.push(...buildAreaBlock(area, areaLabel));
    });
  }

  return blocks;
}

// ═══════════════════════════════════════════════════════════════════════════
//  본문 3 — 화면별 상세
// ═══════════════════════════════════════════════════════════════════════════

function buildScreensDetail(input: UnitWorkExportInput): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [heading1("3. 화면별 상세")];

  if (input.screens.length === 0) {
    blocks.push(p("(화면이 등록되지 않았습니다.)", { color: "808080" }));
    return blocks;
  }

  input.screens.forEach((sc, i) => {
    blocks.push(...buildScreenBlock(sc, i + 1));
    // 화면 사이 페이지 구분 — 마지막 화면이 아니면
    if (i < input.screens.length - 1) {
      blocks.push(new Paragraph({ children: [new PageBreak()] }));
    }
  });

  return blocks;
}

// ═══════════════════════════════════════════════════════════════════════════
//  메인
// ═══════════════════════════════════════════════════════════════════════════

const DOC_KIND = "프로그램 사양서";

/**
 * 단위업무 1건의 프로그램 사양서 docx 파일 Buffer 를 만든다.
 */
export async function buildUnitWorkDocx(input: UnitWorkExportInput): Promise<Buffer> {
  const doc = buildDocument({
    ordererName: input.ordererName,
    docKind:     DOC_KIND,
    copyright:   input.copyright,
    title:       `${input.unitWorkDisplayId} ${DOC_KIND}`,
    description: `${input.unitWorkDisplayId} ${input.unitWorkName} - ${input.ordererName}`,
    // 머리글 우측 문서번호는 표지(buildCover)에 이미 표기되므로 헤더에는 미표시
    children: [
      ...buildCover(input, DOC_KIND),
      ...buildHistory(input),
      ...buildToc(),
      ...buildUnitWorkSection(input),
      ...buildScreenSummary(input),
      ...buildScreensDetail(input),
    ],
  });

  // 10pt 초과 글꼴을 1pt 축소 (10pt 이하 유지) — 다른 Word 산출물과 동일 정책.
  const buffer = await Packer.toBuffer(doc);
  return shrinkDocxFonts(buffer);
}
