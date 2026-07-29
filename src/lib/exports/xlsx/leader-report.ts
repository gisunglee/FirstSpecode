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

// 협조/이슈 표 · 사업수행 표가 같은 데이터 그리드(C~M)를 공유한다.
// 이슈 표는 4개 그룹(내용4/조치4/요청자1/담당자1/상태1=11)으로, 사업수행 표는 HALF_END
// 기준으로 나눠 쓴다 — 두 표를 같은 그리드 위에서 서로 다르게 merge 하는 것뿐이라 폭이
// 어긋나지 않는다.
// "요청일~목표일" 전용 컬럼은 폐지(2026-07-29) — 시트 전체가 너무 가로로 넓다는 피드백으로,
// 요청자/담당자 컬럼을 재사용해 그 아래 행(2행)에 요청일/목표일을 배치(아래 이슈 표 참조).
// "구분"(category) 컬럼도 10→13으로 넓힘 — "금주 코멘트"(5자) 라벨이 잘려 보이던 문제 해결.
const COL = {
  margin:   1,
  category: 2,
  content:  3, // ~6 (4칸)
  action:   7, // ~10 (4칸)
  requester: 11,
  assignee:  12,
  status:   13,
} as const;
const CONTENT_END = 6;
const ACTION_END   = 10;
const LAST_COL     = COL.status;
// 사업수행 표 "금주 실적" 병합 끝 — 원래 8(6칸,72유닛)이었으나 "차주 계획"(9~13, 56유닛)보다
// 훨씬 넓어 보인다는 피드백(2026-07-29)으로 1칸 줄임. 7(5칸,60유닛) vs 나머지 6칸(68유닛)로
// 정확히 반반은 아니지만(그리드가 11칸 홀수라 완전히 같게는 못 나눔) 훨씬 균형 잡힘.
const HALF_END     = 7;

export async function buildLeaderReportXlsx(input: LeaderReportXlsxInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator        = "SPECODE";
  wb.title          = `${input.projectName} 주간업무보고서`;
  wb.created        = new Date();
  wb.lastModifiedBy = "SPECODE";

  const ws = wb.addWorksheet("주간업무보고서", { views: [{ showGridLines: false }] });

  ws.getColumn(COL.margin).width   = 2;
  ws.getColumn(COL.category).width = 13;
  for (let c = COL.content; c <= CONTENT_END; c++) ws.getColumn(c).width = 12;
  for (let c = COL.action; c <= ACTION_END; c++) ws.getColumn(c).width = 12;
  ws.getColumn(COL.requester).width = 11;
  ws.getColumn(COL.assignee).width  = 11;
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
  // dateRange 컬럼 폐지로 "보고일자" 라벨/값 배치를 requester~status 3칸으로 재조정(2026-07-29)
  const weekRow = ws.addRow([]);
  weekRow.getCell(COL.category).value = "주차";
  ws.mergeCells(weekRow.number, COL.content, weekRow.number, ACTION_END);
  weekRow.getCell(COL.content).value = input.weekLabel;
  weekRow.getCell(COL.requester).value = "보고일자";
  ws.mergeCells(weekRow.number, COL.assignee, weekRow.number, LAST_COL);
  weekRow.getCell(COL.assignee).value = input.reportDateLabel;
  applyLabelCell(weekRow.getCell(COL.category));
  applyValueCell(weekRow.getCell(COL.content));
  applyLabelCell(weekRow.getCell(COL.requester));
  applyValueCell(weekRow.getCell(COL.assignee));
  // 값 컬럼 폭이 좁아져(assignee+status=21유닛) 날짜 라벨이 2줄로 접힐 수 있어 고정 22 대신 추정
  weekRow.height = estimateRowHeight([input.reportDateLabel], 21, 22);
  ws.addRow([]);

  // ── 협조 및 이슈사항 현황 ──────────────────────────────────────────────
  const issueTitleRow = ws.addRow([]);
  issueTitleRow.getCell(COL.category).value = "협조 및 이슈사항 현황";
  ws.mergeCells(issueTitleRow.number, COL.category, issueTitleRow.number, LAST_COL);
  issueTitleRow.getCell(COL.category).font = { bold: true, size: 12 };

  // 헤더 2행 구조 — 3행(요청자/담당자 병합 라벨 + 요청자·담당자 + 요청일·목표일)은
  // 맨 위 병합 라벨이 바로 아래 요청자/담당자와 같은 말을 두 번 보여주는 셈이라 불필요하다는
  // 피드백(2026-07-29) → 요청자/담당자를 1행에 바로 놓고, 요청일/목표일만 2행으로 내림.
  //   1행: 구분/내용/조치계획·결과/상태(rowSpan 2) + 요청자 + 담당자
  //   2행: 요청일 | 목표일
  const issueHeaderRow1 = ws.addRow([]);
  const issueHeaderRow2 = ws.addRow([]);

  issueHeaderRow1.getCell(COL.category).value = "구분";
  ws.mergeCells(issueHeaderRow1.number, COL.category, issueHeaderRow2.number, COL.category);

  issueHeaderRow1.getCell(COL.content).value = "내용";
  ws.mergeCells(issueHeaderRow1.number, COL.content, issueHeaderRow2.number, CONTENT_END);

  issueHeaderRow1.getCell(COL.action).value = "조치 계획 / 결과";
  ws.mergeCells(issueHeaderRow1.number, COL.action, issueHeaderRow2.number, ACTION_END);

  issueHeaderRow1.getCell(COL.requester).value = "요청자";
  issueHeaderRow1.getCell(COL.assignee).value  = "담당자";

  issueHeaderRow1.getCell(COL.status).value = "상태";
  ws.mergeCells(issueHeaderRow1.number, COL.status, issueHeaderRow2.number, COL.status);

  issueHeaderRow2.getCell(COL.requester).value = "요청일";
  issueHeaderRow2.getCell(COL.assignee).value  = "목표일";

  applyHeaderRow(issueHeaderRow1, COL.category, LAST_COL);
  applyHeaderRow(issueHeaderRow2, COL.requester, COL.assignee);

  if (input.issues.length === 0) {
    const r = ws.addRow([]);
    r.getCell(COL.category).value = "등록된 이슈가 없습니다.";
    ws.mergeCells(r.number, COL.category, r.number, LAST_COL);
    applyValueCell(r.getCell(COL.category), "center");
  } else {
    for (const issue of input.issues) {
      const r1 = ws.addRow([]);
      const r2 = ws.addRow([]);

      r1.getCell(COL.category).value = issue.categoryLabel;
      ws.mergeCells(r1.number, COL.category, r2.number, COL.category);

      r1.getCell(COL.content).value = issue.cn;
      ws.mergeCells(r1.number, COL.content, r2.number, CONTENT_END);

      r1.getCell(COL.action).value = issue.actionCn;
      ws.mergeCells(r1.number, COL.action, r2.number, ACTION_END);

      r1.getCell(COL.status).value = issue.statusLabel;
      ws.mergeCells(r1.number, COL.status, r2.number, COL.status);

      // 요청자/담당자는 1행, 요청일/목표일은 그 바로 아래 2행 — 같은 컬럼(요청자/담당자
      // 컬럼)을 그대로 재사용해 별도 컬럼을 늘리지 않는다.
      r1.getCell(COL.requester).value = issue.requesterNm;
      r1.getCell(COL.assignee).value  = issue.assigneeNm;
      r2.getCell(COL.requester).value = issue.reqDt;
      r2.getCell(COL.assignee).value  = issue.dueDt;

      applyValueCell(r1.getCell(COL.category), "center");
      applyValueCell(r1.getCell(COL.content));
      applyValueCell(r1.getCell(COL.action));
      applyValueCell(r1.getCell(COL.status), "center");
      applyValueCell(r1.getCell(COL.requester), "center");
      applyValueCell(r1.getCell(COL.assignee), "center");
      applyValueCell(r2.getCell(COL.requester), "center");
      applyValueCell(r2.getCell(COL.assignee), "center");

      // 내용/조치 계획·결과가 필요로 하는 총 높이(r1+r2 합산)를 추정해 두 행에 "균등하게"
      // 나눈다 — 전부 r1에 몰아줬더니 요청자/담당자(r1) 행만 유난히 커 보이고 요청일/목표일
      // (r2)은 눌려 보인다는 피드백(2026-07-29). 절반씩 나누면 둘 다 자연스러운 높이가 된다.
      const totalHeight = estimateRowHeight([issue.cn, issue.actionCn], 48);
      const halfHeight = Math.max(20, Math.ceil(totalHeight / 2));
      r1.height = halfHeight;
      r2.height = halfHeight;
    }
  }
  ws.addRow([]);

  // ── 사업수행 실적 및 계획 ──────────────────────────────────────────────
  const bizTitleRow = ws.addRow([]);
  bizTitleRow.getCell(COL.category).value = "사업수행 실적 및 계획";
  ws.mergeCells(bizTitleRow.number, COL.category, bizTitleRow.number, LAST_COL);
  bizTitleRow.getCell(COL.category).font = { bold: true, size: 12 };

  const PLAN_START = HALF_END + 1; // "차주 계획" 시작 컬럼 — HALF_END 바로 다음

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
  // 금주 실적(3~7, 60유닛)과 차주 계획(8~13, 68유닛) — 폭이 달라 같다고 가정한 추정치를
  // 그대로 쓰면 좁은 쪽 줄바꿈이 적게 잡혀 실제로 열어보면 텍스트가 눌려 보인다.
  // 각자의 실제 폭으로 따로 추정해 더 큰 쪽으로 맞춘다.
  const perfHeight = estimateRowHeight([input.perfCn], 60, 60);
  const planHeight = estimateRowHeight([input.planCn], 68, 60);
  bizRow.height = Math.max(perfHeight, planHeight);

  // ── 금주 코멘트 / 특이사항 (항상 표시 — 비어 있으면 "-") ─────────────────
  ws.addRow([]);
  // content~status 병합 폭(4*12 + 4*12 + 11 + 11 + 10) — 아래 컬럼 width 설정과 반드시 맞출 것
  const valueWidthUnits = 48 + 48 + 11 + 11 + 10;

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
