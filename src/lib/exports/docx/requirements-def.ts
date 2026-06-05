/**
 * exports/docx/requirements-def.ts — 요구사항 정의서 docx 빌더
 *
 * 역할:
 *   - 프로젝트의 요구사항 전체를 한 docx 파일로 묶어 출력 (프로젝트 단위 산출물)
 *   - 핵심: 고객 협의 결과(curncy_cn 현행본) 박제 + 옵션으로 원본/변경이력 동봉
 *
 * 명칭 구분:
 *   - 요구사항 명세서 (requirement.ts)        : RQ 1건 = 1파일. 단건 검토용
 *   - 요구사항 정의서 (이 파일)                : 프로젝트 전체. 협의 결과 박제용
 *
 * 본문 구조:
 *   1. 프로젝트 정보
 *   2. 요구사항 일람        (No / RQ-ID / 이름 / 변경여부 / 우선 / 출처 / 담당자)
 *   3. 요구사항 상세
 *      3.X [REQ-XXXXX] 요구사항명
 *           메타 표
 *           ─ 현행본 ─                    (필수)
 *           ─ 원본 (수정됨) ─               (옵션 ON + 변경된 항목만)
 *           ─ 변경 이력 ─                   (옵션 ON)
 *
 * 책임 분리:
 *   - 데이터 매핑(DB → input + 옵션 처리): requirements-def-data.ts
 *   - 옵션 분기는 데이터 단계에서 끝남 — 빌더는 input 의 필드 유무만 보고 출력
 *   - 양식 토큰: tokens.ts / 빌딩 블록: helpers.ts / 마크다운: markdown.ts / 프레임: frame.ts
 */

import {
  Packer, Paragraph, Table, TableRow, TextRun, PageBreak, TableOfContents,
  AlignmentType, WidthType,
} from "docx";
import {
  COLOR_PRIMARY,
  SIZE_TITLE_LARGE, SIZE_TITLE_MID,
  SIZE_HEADING_1,
  CONTENT_WIDTH,
} from "./tokens";
import {
  p, labelCell, valueCell, headerCell, projectTitleRuns,
  buildCoverMetaTable,
} from "./helpers";
import { buildDocument, heading1, heading2 } from "./frame";
import { renderMarkdown } from "./markdown";
import { shrinkDocxFonts } from "./shrink-fonts";
import { docMetaCoverRows, type ResolvedDocMeta } from "@/lib/exports/doc-meta";

// ═══════════════════════════════════════════════════════════════════════════
//  입력 타입
// ═══════════════════════════════════════════════════════════════════════════

/** 변경 이력 1행 — TbRqRequirementHistory 매핑. */
export type RequirementHistoryEntry = {
  version:       string;  // vrsn_no
  date:          string;  // YYYY-MM-DD
  comment:       string;  // vrsn_coment_cn (변경 사유)
  changerName:   string;  // chg_mber_id 의 멤버명 ("미지정" fallback)
};

/** 요구사항 정의서의 한 요구사항 — 일람표 + 상세 양쪽에 사용. */
export type RequirementItem = {
  // 메타 (일람·상세 공용)
  displayId:      string; // REQ-XXXXX
  name:           string;
  parentTaskName: string;
  priorityLabel:  string;
  sourceLabel:    string;
  rfpPage:        string;
  assigneeName:   string;
  sortOrder:      number;

  // 본문
  currentContent:  string;             // curncy_cn (필수, 빈 문자열도 허용)
  originalContent?: string;            // orgnl_cn — 옵션 ON + 변경된 경우만
  wasModified:     boolean;            // 일람표 "변경여부" 컬럼 표시용 (orgnl ≠ curncy)
  histories?:      RequirementHistoryEntry[]; // 옵션 ON 시
};

/** 프로젝트 단위 산출물의 입력 — 옵션 분기는 매핑 단계에서 끝나 빌더 input 에는
 *  "출력할 필드만" 채워져 들어온다 (예: 옵션 OFF 면 originalContent/histories 미포함). */
export type RequirementsDefExportInput = {
  // ── 발주처/문서 메타 ────────────────────────────
  ordererName: string;
  copyright:   string;

  // ── 프로젝트 ───────────────────────────────────
  projectName: string;
  // 프로젝트 약어 — 표지의 프로젝트명 옆 "[ABBR]" 칩. 미설정이면 생략.
  projectAbbr?: string | null;

  // ── 요구사항 목록 ──────────────────────────────
  requirements: RequirementItem[];

  // ── 옵션 표시용 (표지/일람에 라벨 노출) ──────────
  /** 원본 옵션 켜졌는지 — 일람표 "변경여부" 컬럼 노출 여부 결정 */
  includeOriginal: boolean;
  /** 변경이력 옵션 켜졌는지 — 표지/안내문에 명시 */
  includeHistory:  boolean;

  // ── 작성일/문서버전/작성자/승인자 ───────────────
  // writtenAt: 본문 "1. 프로젝트 정보" 작성일 행에 사용.
  // documentVersion/authorName/approverName: 표지엔 미표시(변경이력 표에만)지만,
  //   발행/이력 시스템(documents/release)이 발행 시 이 값을 fallback·스냅샷에 사용하므로
  //   입력 계약상 필수다. (REQUIREMENTS_DEF 는 발행 대상 산출물)
  documentVersion: string;
  writtenAt:       string;
  authorName:      string;
  approverName:    string;

  // ── 문서 메타/번호 (시스템명·단계·활동·작업·문서번호) ──
  docMeta: ResolvedDocMeta;

  // ── 변경 이력 (문서 자체 — 산출물 발행 이력) ───
  history: Array<{
    version:  string;
    date:     string;
    change:   string;
    author:   string;
    approver: string;
  }>;
};

// ═══════════════════════════════════════════════════════════════════════════
//  표지 / 변경이력 / 목차
// ═══════════════════════════════════════════════════════════════════════════

function buildCover(input: RequirementsDefExportInput, docKind: string): (Paragraph | Table)[] {
  const blank = (size: number) =>
    new Paragraph({ spacing: { before: size }, children: [new TextRun("")] });

  const COVER_LABEL_W = 1800;
  const COVER_VALUE_W = 3600;
  // 표지 메타표 — 시스템명/단계/활동/작업 + 문서번호.
  // 작성일/문서버전/작성자/승인자는 변경이력 페이지에 있어 표지에선 생략 (중복 제거).
  const coverInfoTable = buildCoverMetaTable(
    docMetaCoverRows(input.docMeta, { includeDocNo: true }),
    COVER_LABEL_W,
    COVER_VALUE_W,
  );

  // 표지 부제 — 요구사항 N건 + 옵션 안내
  const optionTags = [
    input.includeOriginal ? "원본 포함" : null,
    input.includeHistory  ? "변경이력 포함" : null,
  ].filter(Boolean).join(" · ");
  const subtitle = optionTags
    ? `요구사항 ${input.requirements.length}건  (${optionTags})`
    : `요구사항 ${input.requirements.length}건`;

  return [
    blank(2000),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing:   { before: 0, after: 200 },
      children:  projectTitleRuns(input.projectName, input.projectAbbr),
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing:   { before: 0, after: 1200 },
      children:  [new TextRun({ text: docKind, font: "맑은 고딕", size: SIZE_TITLE_LARGE, bold: true, color: COLOR_PRIMARY })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing:   { before: 0, after: 100 },
      children:  [new TextRun({ text: subtitle, font: "맑은 고딕", size: SIZE_TITLE_MID, bold: true })],
    }),
    blank(1600),
    coverInfoTable,
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function buildHistory(input: RequirementsDefExportInput): (Paragraph | Table)[] {
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
//  본문 1 — 프로젝트 정보
// ═══════════════════════════════════════════════════════════════════════════

function buildProjectInfoSection(input: RequirementsDefExportInput): (Paragraph | Table)[] {
  const META_LABEL_W = 1700;
  const META_VALUE_W = (CONTENT_WIDTH - META_LABEL_W * 2) / 2;
  const W4 = [META_LABEL_W, META_VALUE_W, META_LABEL_W, META_VALUE_W];

  // 변경된 요구사항 건수 — 일람·문서 안내용 (현행 ≠ 원본)
  const modifiedCount = input.requirements.filter((r) => r.wasModified).length;

  return [
    heading1("1. 프로젝트 정보"),
    new Table({
      width:        { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: W4,
      rows: [
        new TableRow({
          children: [
            labelCell("프로젝트명", W4[0]), valueCell(input.projectName, W4[1]),
            labelCell("발주처",     W4[2]), valueCell(input.ordererName,  W4[3]),
          ],
        }),
        new TableRow({
          children: [
            labelCell("작성일",       W4[0]), valueCell(input.writtenAt,                                 W4[1]),
            labelCell("요구사항 건수", W4[2]), valueCell(`전체 ${input.requirements.length}건 / 변경 ${modifiedCount}건`, W4[3]),
          ],
        }),
      ],
    }),
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
//  본문 2 — 요구사항 일람
// ═══════════════════════════════════════════════════════════════════════════

function buildSummarySection(input: RequirementsDefExportInput): (Paragraph | Table)[] {
  if (input.requirements.length === 0) {
    return [
      heading1("2. 요구사항 일람"),
      p("(등록된 요구사항이 없습니다.)", { color: "808080" }),
    ];
  }

  // "변경여부" 컬럼은 원본 옵션 ON일 때만 노출 (옵션 OFF면 의미 없음)
  const showModified = input.includeOriginal;

  // 컬럼 폭 — 변경여부 ON/OFF 따라 조정
  const W_NO   = 500;
  const W_ID   = 1100;
  const W_PRI  = 850;
  const W_SRC  = 700;
  const W_TASK = 1500;
  const W_ASGN = 1100;
  const W_MOD  = showModified ? 700 : 0;
  const W_NM   = CONTENT_WIDTH - W_NO - W_ID - W_PRI - W_SRC - W_TASK - W_ASGN - W_MOD;

  const headerCells = [
    headerCell("No",        W_NO),
    headerCell("요구사항 ID", W_ID),
    headerCell("요구사항명",  W_NM),
    headerCell("상위 과업",   W_TASK),
    headerCell("우선순위",   W_PRI),
    headerCell("출처",       W_SRC),
    headerCell("담당자",     W_ASGN),
    ...(showModified ? [headerCell("변경", W_MOD)] : []),
  ];
  const widths = showModified
    ? [W_NO, W_ID, W_NM, W_TASK, W_PRI, W_SRC, W_ASGN, W_MOD]
    : [W_NO, W_ID, W_NM, W_TASK, W_PRI, W_SRC, W_ASGN];

  const headerRow = new TableRow({ tableHeader: true, children: headerCells });

  const rows = input.requirements.map((r, i) => {
    const dataCells = [
      valueCell(String(i + 1),     W_NO,   { align: AlignmentType.CENTER }),
      valueCell(r.displayId,        W_ID,   { align: AlignmentType.CENTER }),
      valueCell(r.name,             W_NM),
      valueCell(r.parentTaskName,   W_TASK),
      valueCell(r.priorityLabel,    W_PRI,  { align: AlignmentType.CENTER }),
      valueCell(r.sourceLabel,      W_SRC,  { align: AlignmentType.CENTER }),
      valueCell(r.assigneeName,     W_ASGN),
      ...(showModified ? [
        valueCell(r.wasModified ? "수정됨" : "-", W_MOD, { align: AlignmentType.CENTER }),
      ] : []),
    ];
    return new TableRow({ children: dataCells });
  });

  return [
    heading1("2. 요구사항 일람"),
    new Table({
      width:        { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: widths,
      rows:         [headerRow, ...rows],
    }),
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
//  본문 3 — 요구사항 상세 (요구사항별 묶음 — 현행본 + 옵션 원본 + 옵션 이력)
// ═══════════════════════════════════════════════════════════════════════════

/** 섹션 내부 작은 부제 (현행본/원본/변경이력) — 좌측 컬러 보더로 시각 구분 */
function subSectionLabel(text: string, badge?: string): Paragraph {
  return new Paragraph({
    spacing: { before: 240, after: 100 },
    children: [
      new TextRun({
        text:  text,
        font:  "맑은 고딕",
        size:  22, // SIZE_BODY 와 동일 — 굵은 본문 톤
        bold:  true,
        color: COLOR_PRIMARY,
      }),
      ...(badge ? [
        new TextRun({
          text:  `  [${badge}]`,
          font:  "맑은 고딕",
          size:  20,
          bold:  true,
          color: "C7361B", // 강조 빨간 톤 — "수정됨" 같은 경고
        }),
      ] : []),
    ],
  });
}

function buildHistoryTable(histories: RequirementHistoryEntry[]): Table {
  const W_VER  = 1100;
  const W_DATE = 1500;
  const W_USER = 1500;
  const W_CMT  = CONTENT_WIDTH - W_VER - W_DATE - W_USER;
  const W = [W_VER, W_DATE, W_USER, W_CMT];

  return new Table({
    width:        { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: W,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          headerCell("버전",   W[0]),
          headerCell("일자",   W[1]),
          headerCell("작성자", W[2]),
          headerCell("사유",   W[3]),
        ],
      }),
      ...histories.map((h) => new TableRow({
        children: [
          valueCell(h.version,     W[0], { align: AlignmentType.CENTER }),
          valueCell(h.date,        W[1], { align: AlignmentType.CENTER }),
          valueCell(h.changerName, W[2], { align: AlignmentType.CENTER }),
          valueCell(h.comment || "-", W[3]),
        ],
      })),
    ],
  });
}

function buildRequirementBlock(req: RequirementItem, idx: number): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [];

  // 헤딩 — heading2 (TOC 자동 수집)
  blocks.push(heading2(`3.${idx} [${req.displayId}] ${req.name || "(이름 미지정)"}`));

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
          labelCell("상위 과업",  W4[0]), valueCell(req.parentTaskName, W4[1]),
          labelCell("출처",       W4[2]), valueCell(req.sourceLabel,    W4[3]),
        ],
      }),
      new TableRow({
        children: [
          labelCell("우선순위",   W4[0]), valueCell(req.priorityLabel,  W4[1]),
          labelCell("RFP 페이지", W4[2]), valueCell(req.rfpPage || "-", W4[3]),
        ],
      }),
      new TableRow({
        children: [
          labelCell("담당자",     W4[0]), valueCell(req.assigneeName,   W4[1]),
          labelCell("정렬 순서",  W4[2]), valueCell(String(req.sortOrder), W4[3]),
        ],
      }),
    ],
  }));

  // ── 현행본 (필수) ──────────────────────────────
  blocks.push(subSectionLabel("◼ 현행본"));
  blocks.push(...renderMarkdown(req.currentContent, {
    emptyText: "(현행본이 작성되지 않았습니다.)",
  }));

  // ── 원본 (옵션 ON + 변경된 경우만 input 에 들어옴) ──
  if (req.originalContent !== undefined) {
    blocks.push(subSectionLabel("◼ 원본", "수정됨"));
    blocks.push(...renderMarkdown(req.originalContent, {
      emptyText: "(원본이 비어 있습니다.)",
    }));
  }

  // ── 변경 이력 (옵션 ON 시 input 에 들어옴) ─────
  if (req.histories !== undefined) {
    blocks.push(subSectionLabel("◼ 변경 이력"));
    if (req.histories.length === 0) {
      blocks.push(p("(변경 이력이 없습니다.)", { color: "808080" }));
    } else {
      blocks.push(buildHistoryTable(req.histories));
    }
  }

  return blocks;
}

function buildDetailSection(input: RequirementsDefExportInput): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [heading1("3. 요구사항 상세")];

  if (input.requirements.length === 0) {
    blocks.push(p("(등록된 요구사항이 없습니다.)", { color: "808080" }));
    return blocks;
  }

  input.requirements.forEach((req, i) => {
    blocks.push(...buildRequirementBlock(req, i + 1));
    if (i < input.requirements.length - 1) {
      blocks.push(new Paragraph({ children: [new PageBreak()] }));
    }
  });

  return blocks;
}

// ═══════════════════════════════════════════════════════════════════════════
//  메인
// ═══════════════════════════════════════════════════════════════════════════

const DOC_KIND = "요구사항 정의서";

/**
 * 프로젝트 단위 요구사항 정의서 docx 파일 Buffer 를 만든다.
 */
export async function buildRequirementsDefDocx(
  input: RequirementsDefExportInput,
): Promise<Buffer> {
  const doc = buildDocument({
    ordererName: input.ordererName,
    docKind:     DOC_KIND,
    copyright:   input.copyright,
    title:       `${input.projectName} ${DOC_KIND}`,
    description: `${input.projectName} ${DOC_KIND} - ${input.ordererName}`,
    docNo:       input.docMeta.docNo, // 머리글 우측 문서번호
    children: [
      ...buildCover(input, DOC_KIND),
      ...buildHistory(input),
      ...buildToc(),
      ...buildProjectInfoSection(input),
      ...buildSummarySection(input),
      ...buildDetailSection(input),
    ],
  });

  // 10pt 초과 글꼴을 1pt 축소 (10pt 이하 유지) — 다른 Word 산출물과 동일 정책.
  const buffer = await Packer.toBuffer(doc);
  return shrinkDocxFonts(buffer);
}
