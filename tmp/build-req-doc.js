/**
 * REQ-00023 요구사항 명세서 생성 스크립트 (공공 SI 표준 양식)
 *
 * 출력: d:/source/FirstSpecode/tmp/REQ-00023_요구사항명세서.docx
 * 폰트: 맑은 고딕
 * 용지: A4
 *
 * 첫 버전 양식 + 머리글에 발주처(한국환경공단) 추가
 */

const fs = require("fs");
const path = require("path");

const NODE_MODULES = "C:/Users/USER/AppData/Roaming/npm/node_modules";
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel,
  BorderStyle, WidthType, ShadingType, VerticalAlign, PageNumber, PageBreak,
  TableOfContents,
} = require(path.join(NODE_MODULES, "docx"));

// ─── 발주처/프로젝트 설정 ────────────────────────────────────
const CONFIG = {
  ordererName: "한국환경공단",
  projectName: "SPECODE 프로젝트",
  copyright: "Copyright ⓒ ㈜자몽컴퍼니 컨소시엄",
  docTitle: "요구사항 명세서",
};

// ─── 데이터 ───────────────────────────────────────────────────
const data = {
  reqId: "REQ-00023",
  reqName: "이메일/비밀번호 로그인",
  parentTask: "이메일 회원가입",
  priority: "낮음 (LOW)",
  source: "RFP",
  sortOrder: "1",
  owner: "미지정",
  rfpPage: "-",

  description: [
    "가입된 이메일과 비밀번호로 SPECODE에 로그인한다.",
    "로그인 실패 시 오류 메시지를 표시하며, 연속 실패 시 계정을 일시 잠금한다.",
  ],
  primaryUsers: ["기존 SPECODE 회원 (PM / 설계자 / 개발자)"],
  menus: ["로그인 화면"],
  functions: [
    "이메일/비밀번호 입력 및 인증 처리",
    "로그인 성공 시 대시보드로 이동",
    "로그인 실패 시 오류 메시지 표시",
    "5회 연속 실패 시 계정 1시간 일시 잠금 처리",
    "잠금 상태에서 이메일로 즉시 잠금 해제 가능",
    "아이디 저장 기능 - 다음 방문 시 이메일 자동 입력",
    "자동 로그인 기능 - 다음 방문 시 자동으로 로그인 처리",
  ],

  // 변경 이력 (최신이 위)
  history: [
    { version: "v1.0", date: "2026-04-26", author: "(작성자명)", approver: "(승인자명)", change: "최초 작성" },
  ],
};

// ─── 공통 스타일 ─────────────────────────────────────────────
const FONT = "맑은 고딕";
const COLOR_HEADER_BG = "1F4E79";
const COLOR_LABEL_BG = "D9E2F3";
const COLOR_BORDER = "808080";

const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER };
const cellBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

// A4 본문 폭
const CONTENT_WIDTH = 9026;

// ─── 헬퍼 함수 ───────────────────────────────────────────────
function p(text, opts = {}) {
  return new Paragraph({
    spacing: { before: 60, after: 60, line: 300 },
    alignment: opts.align ?? AlignmentType.LEFT,
    ...opts.paragraphProps,
    children: [
      new TextRun({
        text,
        font: FONT,
        size: opts.size ?? 22,
        bold: opts.bold ?? false,
        color: opts.color,
      }),
    ],
  });
}

function labelCell(text, width) {
  return new TableCell({
    borders: cellBorders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: COLOR_LABEL_BG, type: ShadingType.CLEAR },
    margins: { top: 100, bottom: 100, left: 140, right: 140 },
    verticalAlign: VerticalAlign.CENTER,
    children: [p(text, { bold: true, size: 20, align: AlignmentType.CENTER })],
  });
}

function valueCell(text, width, opts = {}) {
  return new TableCell({
    borders: cellBorders,
    width: { size: width, type: WidthType.DXA },
    margins: { top: 100, bottom: 100, left: 140, right: 140 },
    verticalAlign: VerticalAlign.CENTER,
    columnSpan: opts.columnSpan,
    children: Array.isArray(text)
      ? text.map((t) => p(t, { size: 20 }))
      : [p(text, { size: 20 })],
  });
}

function sectionHeading(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 360, after: 180 },
    children: [
      new TextRun({ text, font: FONT, size: 26, bold: true, color: "1F4E79" }),
    ],
  });
}

function bulletItem(text) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { before: 40, after: 40, line: 300 },
    children: [new TextRun({ text, font: FONT, size: 22 })],
  });
}

function numberedItem(text) {
  return new Paragraph({
    numbering: { reference: "numbers", level: 0 },
    spacing: { before: 40, after: 40, line: 300 },
    children: [new TextRun({ text, font: FONT, size: 22 })],
  });
}

// ─── 메타데이터 표 ───────────────────────────────────────────
const META_LABEL_W = 1700;
const META_VALUE_W = (CONTENT_WIDTH - META_LABEL_W * 2) / 2;

const metaTable = new Table({
  width: { size: CONTENT_WIDTH, type: WidthType.DXA },
  columnWidths: [META_LABEL_W, META_VALUE_W, META_LABEL_W, META_VALUE_W],
  rows: [
    new TableRow({
      tableHeader: true,
      children: [
        new TableCell({
          borders: cellBorders,
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          shading: { fill: COLOR_HEADER_BG, type: ShadingType.CLEAR },
          margins: { top: 120, bottom: 120, left: 140, right: 140 },
          columnSpan: 4,
          verticalAlign: VerticalAlign.CENTER,
          children: [
            p("요구사항 기본 정보", {
              bold: true, size: 24, color: "FFFFFF",
              align: AlignmentType.CENTER,
            }),
          ],
        }),
      ],
    }),
    new TableRow({
      children: [
        labelCell("요구사항 ID", META_LABEL_W),
        valueCell(data.reqId, META_VALUE_W),
        labelCell("요구사항명", META_LABEL_W),
        valueCell(data.reqName, META_VALUE_W),
      ],
    }),
    new TableRow({
      children: [
        labelCell("상위 과업", META_LABEL_W),
        valueCell(data.parentTask, META_VALUE_W),
        labelCell("출처", META_LABEL_W),
        valueCell(data.source, META_VALUE_W),
      ],
    }),
    new TableRow({
      children: [
        labelCell("우선순위", META_LABEL_W),
        valueCell(data.priority, META_VALUE_W),
        labelCell("RFP 페이지", META_LABEL_W),
        valueCell(data.rfpPage, META_VALUE_W),
      ],
    }),
    new TableRow({
      children: [
        labelCell("담당자", META_LABEL_W),
        valueCell(data.owner, META_VALUE_W),
        labelCell("정렬 순서", META_LABEL_W),
        valueCell(data.sortOrder, META_VALUE_W),
      ],
    }),
  ],
});

// ─── 표지 ────────────────────────────────────────────────────
const titlePage = [
  new Paragraph({ spacing: { before: 2000 }, children: [new TextRun("")] }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 200 },
    children: [new TextRun({ text: CONFIG.projectName, font: FONT, size: 28, bold: true })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 1200 },
    children: [new TextRun({ text: CONFIG.docTitle, font: FONT, size: 56, bold: true, color: "1F4E79" })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 100 },
    children: [new TextRun({ text: data.reqId, font: FONT, size: 32, bold: true })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 2000 },
    children: [new TextRun({ text: data.reqName, font: FONT, size: 32 })],
  }),
  new Table({
    width: { size: 5400, type: WidthType.DXA },
    columnWidths: [1800, 3600],
    alignment: AlignmentType.CENTER,
    rows: [
      new TableRow({
        children: [labelCell("작성일", 1800), valueCell(new Date().toISOString().slice(0, 10), 3600)],
      }),
      new TableRow({
        children: [labelCell("문서 버전", 1800), valueCell("v1.0", 3600)],
      }),
      new TableRow({
        children: [labelCell("작성자", 1800), valueCell("(작성자명)", 3600)],
      }),
      new TableRow({
        children: [labelCell("승인자", 1800), valueCell("(승인자명)", 3600)],
      }),
    ],
  }),
  new Paragraph({ children: [new PageBreak()] }),
];

// ─── 변경이력 페이지 ─────────────────────────────────────────
// 컬럼: 버전 / 작성일 / 변경 내용 / 작성자 / 승인자
const HIST_W = [1100, 1500, CONTENT_WIDTH - 1100 - 1500 - 1500 - 1500, 1500, 1500];

function histHeaderCell(text, width) {
  return new TableCell({
    borders: cellBorders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: COLOR_HEADER_BG, type: ShadingType.CLEAR },
    margins: { top: 100, bottom: 100, left: 140, right: 140 },
    verticalAlign: VerticalAlign.CENTER,
    children: [p(text, { bold: true, size: 20, color: "FFFFFF", align: AlignmentType.CENTER })],
  });
}

const historyPage = [
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 0, after: 240 },
    children: [new TextRun({ text: "변경 이력", font: FONT, size: 36, bold: true, color: "1F4E79" })],
  }),
  p("본 문서의 작성·검토·승인 이력은 다음과 같습니다.", { size: 22, after: 200 }),
  new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: HIST_W,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          histHeaderCell("버전", HIST_W[0]),
          histHeaderCell("작성일", HIST_W[1]),
          histHeaderCell("변경 내용", HIST_W[2]),
          histHeaderCell("작성자", HIST_W[3]),
          histHeaderCell("승인자", HIST_W[4]),
        ],
      }),
      ...data.history.map((h) =>
        new TableRow({
          children: [
            valueCell(h.version, HIST_W[0]),
            valueCell(h.date, HIST_W[1]),
            valueCell(h.change, HIST_W[2]),
            valueCell(h.author, HIST_W[3]),
            valueCell(h.approver, HIST_W[4]),
          ],
        })
      ),
    ],
  }),
  new Paragraph({ children: [new PageBreak()] }),
];

// ─── 목차 페이지 ─────────────────────────────────────────────
// Heading1, Heading2 자동 수집 (Word에서 열 때 F9 또는 자동 갱신)
const tocPage = [
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 0, after: 240 },
    children: [new TextRun({ text: "목차", font: FONT, size: 36, bold: true, color: "1F4E79" })],
  }),
  new TableOfContents("목차", {
    hyperlink: true,
    headingStyleRange: "1-2",
    captionLabel: false,
  }),
  new Paragraph({ children: [new PageBreak()] }),
];

// ─── 본문 ────────────────────────────────────────────────────
const body = [
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 0, after: 240 },
    children: [new TextRun({ text: "1. 요구사항 개요", font: FONT, size: 32, bold: true, color: "1F4E79" })],
  }),
  metaTable,

  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 480, after: 240 },
    children: [new TextRun({ text: "2. 상세 명세", font: FONT, size: 32, bold: true, color: "1F4E79" })],
  }),

  sectionHeading("2.1. 요구사항 설명"),
  ...data.description.map((line) => p(line, { size: 22 })),

  sectionHeading("2.2. 주 사용자"),
  ...data.primaryUsers.map(bulletItem),

  sectionHeading("2.3. 관련 메뉴"),
  ...data.menus.map(bulletItem),

  sectionHeading("2.4. 기능 설명"),
  ...data.functions.map(numberedItem),
];

// ─── 머리글 (좌: 발주처, 우: 문서명) ────────────────────────
// 자몽컴퍼니 양식 참고: 표 1행 2열 + 회색 하단선
const HEADER_HALF = CONTENT_WIDTH / 2;
const docHeader = new Header({
  children: [
    new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: [HEADER_HALF, HEADER_HALF],
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders: noBorders,
              width: { size: HEADER_HALF, type: WidthType.DXA },
              children: [p(CONFIG.ordererName, { size: 20, bold: true, align: AlignmentType.LEFT })],
            }),
            new TableCell({
              borders: noBorders,
              width: { size: HEADER_HALF, type: WidthType.DXA },
              children: [p(CONFIG.docTitle, { size: 20, align: AlignmentType.RIGHT })],
            }),
          ],
        }),
      ],
    }),
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: "808080", space: 1 } },
      spacing: { before: 0, after: 0 },
      children: [new TextRun({ text: "" })],
    }),
  ],
});

// ─── 바닥글 (페이지번호 + 저작권) ───────────────────────────
const docFooter = new Footer({
  children: [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18 }),
        new TextRun({ text: " / ", font: FONT, size: 18 }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 18 }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 60 },
      children: [new TextRun({ text: CONFIG.copyright, font: FONT, size: 16, color: "808080" })],
    }),
  ],
});

// ─── 문서 생성 ───────────────────────────────────────────────
const doc = new Document({
  creator: CONFIG.projectName,
  title: `${data.reqId} ${CONFIG.docTitle}`,
  description: `${data.reqId} ${data.reqName} - ${CONFIG.ordererName}`,
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      {
        id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: FONT, color: "1F4E79" },
        paragraph: { spacing: { before: 360, after: 240 }, outlineLevel: 0 },
      },
      {
        id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: FONT, color: "1F4E79" },
        paragraph: { spacing: { before: 300, after: 180 }, outlineLevel: 1 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
      {
        reference: "numbers",
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    headers: { default: docHeader },
    footers: { default: docFooter },
    children: [...titlePage, ...historyPage, ...tocPage, ...body],
  }],
});

const outputPath = "d:/source/FirstSpecode/tmp/REQ-00023_요구사항명세서.docx";
Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(outputPath, buffer);
  console.log(`Created: ${outputPath}`);
  console.log(`Size: ${(buffer.length / 1024).toFixed(1)} KB`);
});
