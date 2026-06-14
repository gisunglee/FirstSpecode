/**
 * exports/docx/task-matrix.ts — 과업대비표 docx 빌더
 *
 * 역할:
 *   - 프로젝트의 과업(SFR)이 요구사항정의서의 요구사항(REF)으로 어떻게 매핑됐는지
 *     한 docx 파일로 출력 (프로젝트 단위 산출물).
 *   - 핵심 목적: RFP/제안서 과업이 요구사항으로 빠짐없이 반영됐는지(누락 방지) 확인.
 *
 * 명칭 구분:
 *   - 요구사항 정의서 (requirements-def.ts) : 요구사항 본문 박제
 *   - 과업대비표 (이 파일)                  : 과업 ↔ 요구사항 매핑 + 반영 현황
 *
 * 레이아웃 (전부 세로 — 다른 산출물과 동일한 모양):
 *   - 가로로 넓게 펼친 매트릭스(본문 포함)는 Word 가 아니라 Excel 산출물에서 제공.
 *   - Word 는 "짧은 매핑표 + (옵션) 세로 상세 블록" 으로 구성해 페이지가 N배로 늘지 않게 한다.
 *
 * 본문 구조:
 *   1. 프로젝트 정보
 *   2. 반영 현황 요약 (전체/반영/미반영 과업 수)
 *   3. 과업-요구사항 매핑표 (내용 없는 짧은 요약 — 항상 출력)
 *   4. 과업대비표 상세 (세로 블록: 과업 → 본문 → 연결 요구사항) — 본문 옵션 ON 일 때만
 *
 * 옵션(매핑 단계에서 이미 반영 — 빌더는 필드 유무만 보고 출력):
 *   - includeTaskContent : 상세 블록에 과업 본문(dtl_cn) 표시
 *   - includeReqContent  : 상세 블록에 요구사항 본문(현행본 curncy_cn) 표시
 *   - 둘 중 하나라도 ON 이면 상세 섹션(4) 출력. 둘 다 OFF 면 매핑표(3)까지만.
 *
 * 책임 분리:
 *   - 데이터 매핑(DB → input + 옵션): task-matrix-data.ts
 *   - 본문(과업/요구사항)은 원본(HTML/마크다운) 그대로 받아 renderMarkdown 으로 서식 렌더
 *   - 양식 토큰: tokens.ts / 빌딩 블록: helpers.ts / 프레임: frame.ts / 마크다운: markdown.ts
 */

import {
  Packer, Paragraph, Table, TableRow, TableCell, TextRun, PageBreak,
  AlignmentType, WidthType, VerticalMergeType,
} from "docx";
import {
  COLOR_PRIMARY,
  SIZE_TITLE_LARGE, SIZE_TITLE_MID,
  SIZE_HEADING_1,
  CONTENT_WIDTH,
} from "./tokens";
import {
  p, labelCell, valueCell, headerCell, projectTitleRuns, horizontalRule, cellBorders,
  buildCoverMetaTable,
} from "./helpers";
import { buildDocument, heading1, heading2 } from "./frame";
import { renderMarkdown } from "./markdown";
import { shrinkDocxFonts } from "./shrink-fonts";
import { docMetaCoverRows, type ResolvedDocMeta } from "@/lib/exports/doc-meta";

// ═══════════════════════════════════════════════════════════════════════════
//  입력 타입
// ═══════════════════════════════════════════════════════════════════════════

/** 과업에 매핑된 요구사항 한 건. */
export type MatrixRequirement = {
  reqDisplayId: string;
  reqName:      string;
  /** 현행본(curncy_cn) 원본(HTML/마크다운) — includeReqContent ON 일 때만 채워짐 */
  reqContent?:  string;
};

/** 과업 1건 + 그에 매핑된 요구사항들 (과업대비표의 한 블록). */
export type MatrixTaskGroup = {
  taskDisplayId: string;  // task_display_id (SFR-XXX)
  taskName:      string;
  rfpSource:     string;  // rfp_page_no (RFP/제안서 출처)
  outputInfo:    string;  // output_info_cn (관련 산출물)
  /** 과업 본문(dtl_cn) 원본(HTML/마크다운) — includeTaskContent ON 일 때만 채워짐 */
  taskContent?:  string;
  mappingType:   string;  // "1:1" | "1:N" | "-"(미반영/미지정)
  reflectStatus: string;  // "반영" | "미반영" | "-"
  /** 매핑된 요구사항. 빈 배열이면 미반영 과업 → 요구사항 칸은 "-". */
  requirements:  MatrixRequirement[];
  /** "(과업 미지정)" 의사 그룹 — 과업 없이 존재하는 요구사항 묶음 */
  isUnassigned?: boolean;
};

/** 과업대비표 입력 — 옵션 분기는 매핑 단계에서 끝나 빌더에는 "출력할 필드만" 들어온다. */
export type TaskMatrixExportInput = {
  // ── 발주처/문서 메타 ────────────────────────────
  ordererName: string;
  copyright:   string;

  // ── 프로젝트 ───────────────────────────────────
  projectName: string;
  projectAbbr?: string | null;

  // ── 본문 ───────────────────────────────────────
  tasks: MatrixTaskGroup[];

  // ── 옵션 표시용 ─────────────────────────────────
  includeTaskContent: boolean;
  includeReqContent:  boolean;

  // ── 문서 메타/번호 (시스템명·단계·활동·작업·문서번호) ──
  // 작성일/문서버전/작성자/승인자는 변경이력(history)에만 표시되므로 표지/본문 입력은 불필요.
  docMeta: ResolvedDocMeta;

  // ── 반영 현황 요약 ─────────────────────────────
  summary: {
    totalTasks:        number;
    reflectedTasks:    number;
    unreflectedTasks:  number;
    totalRequirements: number;
  };

  // ── 변경 이력 (문서 자체 — 산출물 발행 이력) ───
  history: Array<{
    version:  string;
    date:     string;
    change:   string;
    author:   string;
    approver: string;
  }>;
};

const DOC_KIND = "과업대비표";

// ═══════════════════════════════════════════════════════════════════════════
//  표지 / 변경이력
// ═══════════════════════════════════════════════════════════════════════════

function buildCover(input: TaskMatrixExportInput): (Paragraph | Table)[] {
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

  // 표지 부제 — 과업 N건 + 옵션 안내
  const optionTags = [
    input.includeTaskContent ? "과업본문 포함" : null,
    input.includeReqContent  ? "요구사항본문 포함" : null,
  ].filter(Boolean).join(" · ");
  const subtitle = optionTags
    ? `과업 ${input.summary.totalTasks}건  (${optionTags})`
    : `과업 ${input.summary.totalTasks}건`;

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
      children:  [new TextRun({ text: DOC_KIND, font: "맑은 고딕", size: SIZE_TITLE_LARGE, bold: true, color: COLOR_PRIMARY })],
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

function buildHistory(input: TaskMatrixExportInput): (Paragraph | Table)[] {
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

// ═══════════════════════════════════════════════════════════════════════════
//  본문 1 — 프로젝트 정보 / 본문 2 — 반영 현황 요약
// ═══════════════════════════════════════════════════════════════════════════

function buildProjectInfoSection(input: TaskMatrixExportInput): (Paragraph | Table)[] {
  const META_LABEL_W = 1700;
  const META_VALUE_W = (CONTENT_WIDTH - META_LABEL_W * 2) / 2;
  const W4 = [META_LABEL_W, META_VALUE_W, META_LABEL_W, META_VALUE_W];

  return [
    heading1("1. 프로젝트 정보"),
    new Table({
      width:        { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: W4,
      rows: [
        // 작성일/문서버전은 표지·변경이력에 이미 있어 여기선 생략 (중복 제거)
        new TableRow({
          children: [
            labelCell("프로젝트명", W4[0]), valueCell(input.projectName, W4[1]),
            labelCell("발주처",     W4[2]), valueCell(input.ordererName,  W4[3]),
          ],
        }),
      ],
    }),
  ];
}

function buildSummarySection(input: TaskMatrixExportInput): (Paragraph | Table)[] {
  const s = input.summary;
  const META_LABEL_W = 2200;
  const META_VALUE_W = (CONTENT_WIDTH - META_LABEL_W * 2) / 2;
  const W4 = [META_LABEL_W, META_VALUE_W, META_LABEL_W, META_VALUE_W];

  return [
    heading1("2. 반영 현황 요약"),
    p("RFP/제안서 과업이 요구사항으로 반영된 현황입니다. 미반영 과업은 누락 점검 대상입니다.", { after: 160 }),
    new Table({
      width:        { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: W4,
      rows: [
        new TableRow({
          children: [
            labelCell("전체 과업",   W4[0]), valueCell(`${s.totalTasks}건`,        W4[1]),
            labelCell("총 요구사항", W4[2]), valueCell(`${s.totalRequirements}건`, W4[3]),
          ],
        }),
        new TableRow({
          children: [
            labelCell("반영 과업",   W4[0]), valueCell(`${s.reflectedTasks}건`,   W4[1]),
            labelCell("미반영 과업", W4[2]), valueCell(`${s.unreflectedTasks}건`, W4[3]),
          ],
        }),
      ],
    }),
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
//  본문 3 — 과업-요구사항 매핑표 (요약, 내용 없음 / 항상 출력)
// ═══════════════════════════════════════════════════════════════════════════
// 짧고 좁은 매핑 요약 — 과업이 어떤 요구사항으로 반영됐는지 한눈에. 본문은 아래 상세에서.

function buildMappingTableSection(input: TaskMatrixExportInput): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [
    heading1("3. 과업-요구사항 매핑표"),
    p("과업이 어떤 요구사항으로 반영됐는지 한눈에 보는 매핑 요약입니다. 본문 내용은 아래 상세에서 확인하세요.",
      { after: 160, color: "595959" }),
  ];

  if (input.tasks.length === 0) {
    blocks.push(p("(등록된 과업이 없습니다.)", { color: "808080" }));
    return blocks;
  }

  // 컬럼 폭 — 고정폭 제외 나머지를 과업명/요구사항명에 균등 분배 (세로 본문폭 기준)
  const W_NO  = 480;
  const W_TID = 1050;
  const W_RID = 1050;
  const W_MAP = 850;
  const W_REF = 850;
  const flexEach = Math.floor((CONTENT_WIDTH - W_NO - W_TID - W_RID - W_MAP - W_REF) / 2);
  const widths = [W_NO, W_TID, flexEach, W_RID, flexEach, W_MAP, W_REF];

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headerCell("No",         W_NO),
      headerCell("과업 ID",     W_TID),
      headerCell("과업명",      flexEach),
      headerCell("요구사항 ID",  W_RID),
      headerCell("요구사항명",   flexEach),
      headerCell("매핑유형",    W_MAP),
      headerCell("반영여부",    W_REF),
    ],
  });

  // 과업 1건이 요구사항 N개면 행 N개로 펼치되, 과업 컬럼(No·과업ID·과업명·매핑유형·반영여부)은
  // 세로 병합해 한 번만 보이게 한다. 요구사항 컬럼만 행마다 채움.
  //   - 첫 행: RESTART(내용 표시) / 나머지 행: CONTINUE(빈 값 — 위 셀에 흡수)
  // 요구사항 0건(미반영)이면 요구사항 칸은 "-" 로 한 행 (병합 불필요).
  const rows: TableRow[] = [headerRow];
  let taskNo = 1;
  for (const t of input.tasks) {
    const reqList: (MatrixRequirement | null)[] =
      t.requirements.length > 0 ? t.requirements : [null];

    reqList.forEach((req, idx) => {
      // 과업 컬럼 — 첫 행만 내용, 나머지는 CONTINUE 병합
      const merge = idx === 0 ? VerticalMergeType.RESTART : VerticalMergeType.CONTINUE;
      const isFirst = idx === 0;
      rows.push(new TableRow({ children: [
        valueCell(isFirst ? String(taskNo)   : "", W_NO,  { align: AlignmentType.CENTER, verticalMerge: merge }),
        valueCell(isFirst ? t.taskDisplayId   : "", W_TID, { align: AlignmentType.CENTER, verticalMerge: merge }),
        valueCell(isFirst ? (t.taskName || "-") : "", flexEach, { verticalMerge: merge }),
        // 요구사항 컬럼 — 행마다
        valueCell(req?.reqDisplayId ?? "-", W_RID, { align: AlignmentType.CENTER }),
        valueCell(req?.reqName || "-",      flexEach),
        valueCell(isFirst ? t.mappingType   : "", W_MAP, { align: AlignmentType.CENTER, verticalMerge: merge }),
        valueCell(isFirst ? t.reflectStatus : "", W_REF, { align: AlignmentType.CENTER, verticalMerge: merge }),
      ] }));
    });
    taskNo += 1;
  }

  blocks.push(new Table({
    width:        { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    rows,
  }));

  return blocks;
}

// ═══════════════════════════════════════════════════════════════════════════
//  본문 4 — 과업대비표 상세 (세로 블록: 과업 → 본문 → 연결 요구사항)
//  본문 옵션(과업본문/요구사항본문 중 하나라도 ON)일 때만 출력.
//  과업당 본문이 1번만 나오므로 가로 매트릭스처럼 N배로 늘어나지 않는다.
// ═══════════════════════════════════════════════════════════════════════════

/** 섹션 내부 작은 부제 (◼ 과업 본문 / ◼ 연결 요구사항) — 진청 강조 */
function subLabel(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text, font: "맑은 고딕", size: 22, bold: true, color: COLOR_PRIMARY })],
  });
}

/**
 * 본문(과업/요구사항)을 테두리 박스 1개로 감싼다.
 *   - 제안요청서 양식처럼 "내용이 박스 안에 담긴" 모양을 위해.
 *   - 1셀 표 + 옅은 회색 테두리. renderMarkdown 결과(문단/표/이미지)를 그대로 셀에 넣음.
 *   - Word 규칙: 셀의 마지막 자식은 문단이어야 함 → 마지막이 표면 빈 문단 보강.
 */
function contentBox(children: (Paragraph | Table)[]): Table {
  const inner = children.length > 0
    ? children
    : [p("(내용 없음)", { color: "808080" })];

  const last = inner[inner.length - 1];
  const cellChildren = last instanceof Table
    ? [...inner, new Paragraph({ children: [new TextRun("")] })]
    : inner;

  return new Table({
    width:        { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [CONTENT_WIDTH],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: cellBorders,
            width:   { size: CONTENT_WIDTH, type: WidthType.DXA },
            margins: { top: 120, bottom: 120, left: 160, right: 160 },
            children: cellChildren,
          }),
        ],
      }),
    ],
  });
}

function buildTaskDetailBlock(t: MatrixTaskGroup, idx: number): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [];

  // 과업 헤딩 — heading2 (TOC 자동 수집)
  const heading = t.isUnassigned
    ? `4.${idx} (과업 미지정)`
    : `4.${idx} [${t.taskDisplayId}] ${t.taskName || "(이름 미지정)"}`;
  blocks.push(heading2(heading));

  // 과업 메타표 (4컬럼)
  const META_LABEL_W = 1500;
  const META_VALUE_W = (CONTENT_WIDTH - META_LABEL_W * 2) / 2;
  const W4 = [META_LABEL_W, META_VALUE_W, META_LABEL_W, META_VALUE_W];
  blocks.push(new Table({
    width:        { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: W4,
    rows: [
      new TableRow({ children: [
        labelCell("RFP 출처", W4[0]), valueCell(t.rfpSource || "-", W4[1]),
        labelCell("매핑유형", W4[2]), valueCell(t.mappingType,      W4[3]),
      ]}),
      new TableRow({ children: [
        labelCell("반영여부", W4[0]), valueCell(t.reflectStatus,    W4[1]),
        labelCell("관련 산출물", W4[2]), valueCell(t.outputInfo || "-", W4[3]),
      ]}),
    ],
  }));

  // 과업 본문 (옵션 ON 시만 input 에 들어옴) — 박스로 감쌈
  if (t.taskContent !== undefined) {
    blocks.push(subLabel("◼ 과업 본문"));
    blocks.push(contentBox(renderMarkdown(t.taskContent, { emptyText: "(과업 본문이 작성되지 않았습니다.)" })));
  }

  // 연결 요구사항 — 각 요구사항 헤더 + (옵션) 본문 박스
  blocks.push(subLabel("◼ 연결 요구사항"));
  if (t.requirements.length === 0) {
    blocks.push(p("(연결된 요구사항이 없습니다 — 미반영)", { color: "808080" }));
  } else {
    t.requirements.forEach((req) => {
      blocks.push(p(`[${req.reqDisplayId}] ${req.reqName || "(이름 미지정)"}`,
        { bold: true, before: 120, after: 40 }));
      if (req.reqContent !== undefined) {
        blocks.push(contentBox(renderMarkdown(req.reqContent, { emptyText: "(요구사항 내용이 작성되지 않았습니다.)" })));
      }
    });
  }

  return blocks;
}

function buildDetailSection(input: TaskMatrixExportInput): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [
    new Paragraph({ children: [new PageBreak()] }),
    heading1("4. 과업대비표 (상세)"),
  ];

  if (input.tasks.length === 0) {
    blocks.push(p("(등록된 과업이 없습니다.)", { color: "808080" }));
    return blocks;
  }

  input.tasks.forEach((t, i) => {
    blocks.push(...buildTaskDetailBlock(t, i + 1));
    // 과업 블록 사이 구분선 — 페이지 강제 분할 대신 자연스러운 흐름 유지
    if (i < input.tasks.length - 1) blocks.push(horizontalRule());
  });

  return blocks;
}

// ═══════════════════════════════════════════════════════════════════════════
//  메인
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 프로젝트 단위 과업대비표 docx 파일 Buffer 를 만든다 (전부 세로).
 *
 * 구조:
 *   - 표지 / 변경이력 / 1.프로젝트정보 / 2.반영현황요약 / 3.과업-요구사항 매핑표(내용 없음, 항상)
 *   - 4.과업대비표 상세(세로 블록, 본문 포함) — 본문 옵션이 하나라도 켜졌을 때만
 *
 * 가로로 넓게 펼친 매트릭스(본문 포함)는 Word 가 아니라 Excel 산출물에서 제공한다.
 */
export async function buildTaskMatrixDocx(
  input: TaskMatrixExportInput,
): Promise<Buffer> {
  // 상세 섹션은 본문 옵션(과업본문/요구사항본문)이 하나라도 켜졌을 때만 붙인다.
  const includeDetail = input.includeTaskContent || input.includeReqContent;

  const doc = buildDocument({
    ordererName: input.ordererName,
    docKind:     DOC_KIND,
    copyright:   input.copyright,
    title:       `${input.projectName} ${DOC_KIND}`,
    description: `${input.projectName} ${DOC_KIND} - ${input.ordererName}`,
    // 머리글 우측 문서번호는 표지(buildCover)에 이미 표기되므로 헤더에는 미표시
    children: [
      ...buildCover(input),
      ...buildHistory(input),
      ...buildProjectInfoSection(input),
      ...buildSummarySection(input),
      ...buildMappingTableSection(input),
      ...(includeDetail ? buildDetailSection(input) : []),
    ],
  });

  // 10pt 초과 글꼴을 1pt 축소 (10pt 이하 유지). 산출물별 점진 적용을 위해 후처리로 처리.
  const buffer = await Packer.toBuffer(doc);
  return shrinkDocxFonts(buffer);
}
