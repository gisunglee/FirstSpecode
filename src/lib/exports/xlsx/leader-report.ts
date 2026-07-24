/**
 * exports/xlsx/leader-report.ts — 리더 리포트 "인쇄 미리보기" 엑셀 빌더
 *
 * 화면(PrintPreviewModal)과 최대한 같은 모습으로: 표지 문구 없이 단일 시트에
 * 주차/보고일자 표 → 협조 및 이슈사항 현황 표 → 사업수행 실적/계획 표 → 금주 코멘트/특이사항 표
 * 순. 금주 코멘트/특이사항은 비어 있어도 "-"로 항상 표시(2026-07-22).
 *
 * 책임 분리: 이 모듈은 이미 화면 표시용으로 가공된 문자열(라벨 등)을 받아 xlsx만 만든다.
 * 데이터 조회·정렬·포맷팅은 호출부(API route)의 책임.
 */

import ExcelJS from "exceljs";

export type LeaderReportXlsxIssue = {
  categoryLabel: string;
  cn:            string;
  actionCn:      string;
  requesterNm:   string;
  assigneeNm:    string;
  reqDt:         string;
  dueDt:         string;
  statusLabel:   string;
};

export type LeaderReportXlsxInput = {
  projectName:      string;
  weekLabel:        string; // 예: "19주차 (07/20 ~ 07/26)"
  reportDateLabel:  string; // 예: "2026년 7월 22일 수요일"
  thisWeekRangeLabel: string; // 예: "07/20 ~ 07/26" — "금주 실적" 헤더에 붙일 날짜
  nextWeekRangeLabel: string; // 예: "07/27 ~ 08/02" — "차주 계획" 헤더에 붙일 날짜
  issues:          LeaderReportXlsxIssue[];
  perfCn:          string;
  planCn:          string;
  commentCn:       string; // 빈 문자열이면 "-"로 표시(섹션 자체는 항상 노출)
  noteCn:          string;
};

const HEADER_FILL_COLOR = "FF1F4E79";
const HEADER_FONT_COLOR = "FFFFFFFF";
const LABEL_FILL_COLOR  = "FFD9E2F3";

function thinBorder(argb: string): Partial<ExcelJS.Borders> {
  return {
    top:    { style: "thin", color: { argb } },
    bottom: { style: "thin", color: { argb } },
    left:   { style: "thin", color: { argb } },
    right:  { style: "thin", color: { argb } },
  };
}

function applyHeaderRow(row: ExcelJS.Row, fromCol: number, toCol: number): void {
  row.height = 22;
  for (let c = fromCol; c <= toCol; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: HEADER_FONT_COLOR } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL_COLOR } };
    cell.border = thinBorder("FF808080");
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  }
}

function applyLabelCell(cell: ExcelJS.Cell): void {
  cell.font = { bold: true };
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LABEL_FILL_COLOR } };
  cell.border = thinBorder("FFBFBFBF");
}

function applyValueCell(cell: ExcelJS.Cell, align: "left" | "center" = "left"): void {
  cell.alignment = { vertical: "middle", horizontal: align, wrapText: true };
  cell.border = thinBorder("FFBFBFBF");
}

// ExcelJS/xlsx 포맷 자체가 "줄바꿈된 셀 높이"를 파일 열 때 자동 계산해 주지 않는다 —
// wrapText만 켜두면 실제 줄 수와 무관하게 기본 한 줄 높이로 고정돼 텍스트가 잘려 보인다.
// 그래서 글자 수 기준으로 대략의 줄 수를 추정해 행 높이를 직접 써준다(완벽한 자동 계산은
// 아니지만 "눌려 보이는" 문제는 해결된다). 한글은 폭이 넓어 컬럼 width 단위의 절반 정도만
// 한 줄에 들어간다고 가정.
function estimateRowHeight(texts: string[], mergedWidthUnits: number, minHeight = 20): number {
  const charsPerLine = Math.max(10, Math.floor(mergedWidthUnits / 2));
  const lineCount = Math.max(
    1,
    ...texts.map((t) =>
      (t || "-").split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)), 0)
    )
  );
  return Math.max(minHeight, lineCount * 15 + 6);
}

// 협조/이슈 표 · 사업수행 표가 같은 12칸짜리 데이터 그리드(C~N)를 공유한다.
// 이슈 표는 5개 그룹(내용4/조치4/요청자·담당자2/요청일~목표일1/상태1=12)으로,
// 사업수행 표는 정확히 반씩(금주실적6/차주계획6)으로 나눠 쓴다 — 두 표를 같은 그리드
// 위에서 서로 다르게 merge 하는 것뿐이라 폭이 어긋나지 않는다.
// (이전엔 금주실적:차주계획이 6:3으로 치우쳐 있었음 — 2026-07-22 피드백으로 정정)
const COL = {
  margin:   1,
  category: 2,
  content:  3, // ~6 (4칸)
  action:   7, // ~10 (4칸)
  who:      11, // ~12 (2칸)
  dateRange: 13,
  status:   14,
} as const;
const CONTENT_END = 6;
const ACTION_END   = 10;
const WHO_END      = 12;
const LAST_COL     = COL.status;
const HALF_END     = 8; // 사업수행 표 "금주 실적" 병합 끝(3~8, 6칸) — 나머지 절반은 9~14

export async function buildLeaderReportXlsx(input: LeaderReportXlsxInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator        = "SPECODE";
  wb.title          = `${input.projectName} 주간업무보고서`;
  wb.created        = new Date();
  wb.lastModifiedBy = "SPECODE";

  const ws = wb.addWorksheet("주간업무보고서", { views: [{ showGridLines: false }] });

  ws.getColumn(COL.margin).width   = 2;
  ws.getColumn(COL.category).width = 10;
  for (let c = COL.content; c <= CONTENT_END; c++) ws.getColumn(c).width = 12;
  for (let c = COL.action; c <= ACTION_END; c++) ws.getColumn(c).width = 12;
  for (let c = COL.who; c <= WHO_END; c++) ws.getColumn(c).width = 12;
  ws.getColumn(COL.dateRange).width = 20;
  ws.getColumn(COL.status).width    = 10;

  // ── 제목 ──────────────────────────────────────────────────────────────
  ws.addRow([]);
  const titleRow = ws.addRow([]);
  titleRow.getCell(COL.category).value = `${input.projectName} 주간업무보고서`;
  ws.mergeCells(titleRow.number, COL.category, titleRow.number, LAST_COL);
  titleRow.getCell(COL.category).font = { size: 18, bold: true };
  titleRow.getCell(COL.category).alignment = { vertical: "middle", horizontal: "center" };
  titleRow.height = 30;
  ws.addRow([]);

  // ── 주차 / 보고일자 ────────────────────────────────────────────────────
  const weekRow = ws.addRow([]);
  weekRow.getCell(COL.category).value = "주차";
  ws.mergeCells(weekRow.number, COL.content, weekRow.number, ACTION_END);
  weekRow.getCell(COL.content).value = input.weekLabel;
  weekRow.getCell(COL.who).value = "보고일자";
  ws.mergeCells(weekRow.number, COL.who, weekRow.number, WHO_END);
  ws.mergeCells(weekRow.number, COL.dateRange, weekRow.number, LAST_COL);
  weekRow.getCell(COL.dateRange).value = input.reportDateLabel;
  applyLabelCell(weekRow.getCell(COL.category));
  applyValueCell(weekRow.getCell(COL.content));
  applyLabelCell(weekRow.getCell(COL.who));
  applyValueCell(weekRow.getCell(COL.dateRange));
  weekRow.height = 22;
  ws.addRow([]);

  // ── 협조 및 이슈사항 현황 ──────────────────────────────────────────────
  const issueTitleRow = ws.addRow([]);
  issueTitleRow.getCell(COL.category).value = "협조 및 이슈사항 현황";
  ws.mergeCells(issueTitleRow.number, COL.category, issueTitleRow.number, LAST_COL);
  issueTitleRow.getCell(COL.category).font = { bold: true, size: 12 };

  const issueHeader = ws.addRow([]);
  issueHeader.getCell(COL.category).value = "구분";
  issueHeader.getCell(COL.content).value  = "내용";
  ws.mergeCells(issueHeader.number, COL.content, issueHeader.number, CONTENT_END);
  issueHeader.getCell(COL.action).value = "조치 계획 / 결과";
  ws.mergeCells(issueHeader.number, COL.action, issueHeader.number, ACTION_END);
  issueHeader.getCell(COL.who).value = "요청자 / 담당자";
  ws.mergeCells(issueHeader.number, COL.who, issueHeader.number, WHO_END);
  issueHeader.getCell(COL.dateRange).value = "요청일 ~ 목표일";
  issueHeader.getCell(COL.status).value = "상태";
  applyHeaderRow(issueHeader, COL.category, LAST_COL);

  if (input.issues.length === 0) {
    const r = ws.addRow([]);
    r.getCell(COL.category).value = "등록된 이슈가 없습니다.";
    ws.mergeCells(r.number, COL.category, r.number, LAST_COL);
    applyValueCell(r.getCell(COL.category), "center");
  } else {
    for (const issue of input.issues) {
      const r = ws.addRow([]);
      r.getCell(COL.category).value = issue.categoryLabel;
      r.getCell(COL.content).value  = issue.cn;
      ws.mergeCells(r.number, COL.content, r.number, CONTENT_END);
      r.getCell(COL.action).value = issue.actionCn;
      ws.mergeCells(r.number, COL.action, r.number, ACTION_END);
      r.getCell(COL.who).value = `${issue.requesterNm} / ${issue.assigneeNm}`;
      ws.mergeCells(r.number, COL.who, r.number, WHO_END);
      r.getCell(COL.dateRange).value = `${issue.reqDt} ~ ${issue.dueDt}`;
      r.getCell(COL.status).value    = issue.statusLabel;
      applyValueCell(r.getCell(COL.category), "center");
      applyValueCell(r.getCell(COL.content));
      applyValueCell(r.getCell(COL.action));
      applyValueCell(r.getCell(COL.who), "center");
      applyValueCell(r.getCell(COL.dateRange), "center");
      applyValueCell(r.getCell(COL.status), "center");
      // 내용/조치 계획·결과 둘 다 4칸(48 width unit) 폭 — 더 긴 쪽 기준으로 행 높이 추정
      r.height = estimateRowHeight([issue.cn, issue.actionCn], 48);
    }
  }
  ws.addRow([]);

  // ── 사업수행 실적 및 계획 ──────────────────────────────────────────────
  const bizTitleRow = ws.addRow([]);
  bizTitleRow.getCell(COL.category).value = "사업수행 실적 및 계획";
  ws.mergeCells(bizTitleRow.number, COL.category, bizTitleRow.number, LAST_COL);
  bizTitleRow.getCell(COL.category).font = { bold: true, size: 12 };

  const PLAN_START = HALF_END + 1; // 그리드 12칸을 정확히 반으로 나눈 뒤쪽 절반의 시작 컬럼

  const bizHeader = ws.addRow([]);
  bizHeader.getCell(COL.category).value = "구분";
  bizHeader.getCell(COL.content).value  = `금주 실적 (${input.thisWeekRangeLabel})`;
  ws.mergeCells(bizHeader.number, COL.content, bizHeader.number, HALF_END);
  bizHeader.getCell(PLAN_START).value = `차주 계획 (${input.nextWeekRangeLabel})`;
  ws.mergeCells(bizHeader.number, PLAN_START, bizHeader.number, LAST_COL);
  applyHeaderRow(bizHeader, COL.category, LAST_COL);

  const bizRow = ws.addRow([]);
  bizRow.getCell(COL.category).value = "사업수행";
  bizRow.getCell(COL.content).value  = input.perfCn || "-";
  ws.mergeCells(bizRow.number, COL.content, bizRow.number, HALF_END);
  bizRow.getCell(PLAN_START).value = input.planCn || "-";
  ws.mergeCells(bizRow.number, PLAN_START, bizRow.number, LAST_COL);
  applyLabelCell(bizRow.getCell(COL.category));
  applyValueCell(bizRow.getCell(COL.content));
  applyValueCell(bizRow.getCell(PLAN_START));
  bizRow.height = estimateRowHeight([input.perfCn, input.planCn], 72, 60);

  // ── 금주 코멘트 / 특이사항 (항상 표시 — 비어 있으면 "-") ─────────────────
  ws.addRow([]);
  // content~status 병합 폭(4*12 + 4*12 + 2*12 + 20 + 10) — 아래 컬럼 width 설정과 반드시 맞출 것
  const valueWidthUnits = 48 + 48 + 24 + 20 + 10;

  const commentRow = ws.addRow([]);
  commentRow.getCell(COL.category).value = "금주 코멘트";
  commentRow.getCell(COL.content).value  = input.commentCn || "-";
  ws.mergeCells(commentRow.number, COL.content, commentRow.number, LAST_COL);
  applyLabelCell(commentRow.getCell(COL.category));
  applyValueCell(commentRow.getCell(COL.content));
  commentRow.height = estimateRowHeight([input.commentCn], valueWidthUnits, 24);

  const noteRow = ws.addRow([]);
  noteRow.getCell(COL.category).value = "특이사항";
  noteRow.getCell(COL.content).value  = input.noteCn || "-";
  ws.mergeCells(noteRow.number, COL.content, noteRow.number, LAST_COL);
  applyLabelCell(noteRow.getCell(COL.category));
  applyValueCell(noteRow.getCell(COL.content));
  noteRow.height = estimateRowHeight([input.noteCn], valueWidthUnits, 24);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
