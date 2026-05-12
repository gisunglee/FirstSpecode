/**
 * exports/xlsx/requirements-def.ts — 요구사항 정의서 xlsx 빌더
 *
 * 시트 구성:
 *   1) "표지"        — 프로젝트 메타 + 산출물 정보 (사람이 첫 화면에서 보는 정보)
 *   2) "변경 이력"    — 산출물 자체의 작성·검토·승인 이력 표 (docx 의 변경이력 페이지와 동일)
 *   3) "요구사항"     — 요구사항 1건 = 1행. 메타 + 현행본 + 원본 + 변경이력을 한 행에
 *
 * 데이터 소스:
 *   - docx 빌더와 동일한 RequirementsDefExportInput 을 그대로 사용.
 *   - 옵션(includeOriginal/includeHistory) 도 input 에 이미 반영돼 있으므로 빌더는 단순 출력.
 *
 * HTML/마크다운 처리:
 *   - 셀 안에 들어가는 본문(현행본/원본)은 htmlToPlainText 로 일반 텍스트로 변환.
 *     이미지는 [이미지] 텍스트 placeholder 로 — 엑셀 셀 임베드는 별개 작업이라 1차에선 텍스트만.
 *
 * 책임 분리:
 *   - 데이터 매핑  : requirements-def-data.ts (docx 와 공유)
 *   - 본 모듈      : input → xlsx Buffer (양식 "구성"만)
 */

import ExcelJS from "exceljs";
import type { RequirementsDefExportInput } from "@/lib/exports/docx/requirements-def";
import { htmlToPlainText } from "@/lib/exports/docx/html";

// ═══════════════════════════════════════════════════════════════════════════
//  스타일 상수 — 시트 간 톤 일관성 유지를 위해 한 곳에 모음
// ═══════════════════════════════════════════════════════════════════════════

/** 헤더 행 색상 — docx 헤더(#1F4E79 짙은 청)와 동일 톤 */
const HEADER_FILL_COLOR = "FF1F4E79";
const HEADER_FONT_COLOR = "FFFFFFFF";

/** 짙은 청 헤더 행 스타일 (시트 공용) */
function applyHeaderStyle(row: ExcelJS.Row): void {
  row.height = 22;
  row.font   = { bold: true, color: { argb: HEADER_FONT_COLOR } };
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  row.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_FILL_COLOR },
    };
    cell.border = {
      top:    { style: "thin", color: { argb: "FF808080" } },
      bottom: { style: "thin", color: { argb: "FF808080" } },
      left:   { style: "thin", color: { argb: "FF808080" } },
      right:  { style: "thin", color: { argb: "FF808080" } },
    };
  });
}

/** 데이터 행에 얇은 보더 적용 */
function applyDataRowBorder(row: ExcelJS.Row): void {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.border = {
      top:    { style: "thin", color: { argb: "FFBFBFBF" } },
      bottom: { style: "thin", color: { argb: "FFBFBFBF" } },
      left:   { style: "thin", color: { argb: "FFBFBFBF" } },
      right:  { style: "thin", color: { argb: "FFBFBFBF" } },
    };
  });
}

/** 라벨/값 2열 형식의 시트(표지 등) 라벨 셀 스타일 */
function applyLabelCellStyle(cell: ExcelJS.Cell): void {
  cell.font   = { bold: true };
  cell.alignment = { vertical: "middle", horizontal: "center" };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD9E2F3" }, // 연청 (docx labelCell 과 동일 톤)
  };
  cell.border = {
    top:    { style: "thin", color: { argb: "FFBFBFBF" } },
    bottom: { style: "thin", color: { argb: "FFBFBFBF" } },
    left:   { style: "thin", color: { argb: "FFBFBFBF" } },
    right:  { style: "thin", color: { argb: "FFBFBFBF" } },
  };
}

function applyValueCellStyle(cell: ExcelJS.Cell): void {
  cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  cell.border = {
    top:    { style: "thin", color: { argb: "FFBFBFBF" } },
    bottom: { style: "thin", color: { argb: "FFBFBFBF" } },
    left:   { style: "thin", color: { argb: "FFBFBFBF" } },
    right:  { style: "thin", color: { argb: "FFBFBFBF" } },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Sheet 1 — 표지
// ═══════════════════════════════════════════════════════════════════════════

function buildCoverSheet(wb: ExcelJS.Workbook, input: RequirementsDefExportInput): void {
  const ws = wb.addWorksheet("표지", {
    views: [{ showGridLines: false }],
    properties: { tabColor: { argb: HEADER_FILL_COLOR } },
  });

  // 컬럼 폭 — 라벨 2 컬럼 + 값 2 컬럼 (총 4 컬럼, 표지에서는 사용 안 하지만 후속 행 위해 준비)
  ws.columns = [
    { width: 18 },
    { width: 42 },
  ];

  // 빈 줄로 상단 여백 — 표지 톤
  ws.addRow([]);
  ws.addRow([]);

  // 프로젝트명 — 큰 글씨
  const projRow = ws.addRow([input.projectName]);
  ws.mergeCells(projRow.number, 1, projRow.number, 2);
  projRow.font = { size: 16, bold: true };
  projRow.alignment = { vertical: "middle", horizontal: "center" };
  projRow.height = 30;

  // 산출물명 — 더 큰 글씨, 진청
  const titleRow = ws.addRow(["요구사항 정의서"]);
  ws.mergeCells(titleRow.number, 1, titleRow.number, 2);
  titleRow.font = { size: 28, bold: true, color: { argb: HEADER_FILL_COLOR } };
  titleRow.alignment = { vertical: "middle", horizontal: "center" };
  titleRow.height = 60;

  // 부제 — 옵션 안내
  const optionTags = [
    input.includeOriginal ? "원본 포함" : null,
    input.includeHistory  ? "변경이력 포함" : null,
  ].filter(Boolean).join(" · ");
  const subtitle = optionTags
    ? `요구사항 ${input.requirements.length}건  (${optionTags})`
    : `요구사항 ${input.requirements.length}건`;
  const subtitleRow = ws.addRow([subtitle]);
  ws.mergeCells(subtitleRow.number, 1, subtitleRow.number, 2);
  subtitleRow.font = { size: 14, bold: true };
  subtitleRow.alignment = { vertical: "middle", horizontal: "center" };
  subtitleRow.height = 22;

  // 작성정보 표 — 라벨/값 (2열)
  ws.addRow([]);
  ws.addRow([]);
  const metaRows: [string, string][] = [
    ["발주처",     input.ordererName],
    ["작성일",     input.writtenAt],
    ["문서 버전",  input.documentVersion],
    ["작성자",     input.authorName],
    ["승인자",     input.approverName],
  ];
  for (const [label, value] of metaRows) {
    const r = ws.addRow([label, value]);
    applyLabelCellStyle(r.getCell(1));
    applyValueCellStyle(r.getCell(2));
    r.height = 20;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Sheet 2 — 변경 이력 (산출물 자체의 발행 이력)
// ═══════════════════════════════════════════════════════════════════════════

function buildHistorySheet(wb: ExcelJS.Workbook, input: RequirementsDefExportInput): void {
  const ws = wb.addWorksheet("변경 이력");

  ws.columns = [
    { header: "버전",      key: "version",  width: 10 },
    { header: "작성일",    key: "date",     width: 14 },
    { header: "변경 내용", key: "change",   width: 50 },
    { header: "작성자",    key: "author",   width: 16 },
    { header: "승인자",    key: "approver", width: 16 },
  ];
  applyHeaderStyle(ws.getRow(1));

  if (input.history.length === 0) {
    const r = ws.addRow(["-", "-", "(이력 없음)", "-", "-"]);
    r.alignment = { vertical: "middle", horizontal: "center" };
    applyDataRowBorder(r);
    return;
  }

  for (const h of input.history) {
    const r = ws.addRow({
      version:  h.version,
      date:     h.date,
      change:   h.change,
      author:   h.author,
      approver: h.approver,
    });
    r.alignment = { vertical: "middle", wrapText: true };
    applyDataRowBorder(r);
  }

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to:   { row: 1, column: 5 },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Sheet 3 — 요구사항 (1건 = 1행, 모든 정보 한 행에)
// ═══════════════════════════════════════════════════════════════════════════

/** 변경이력 배열 → 한 셀에 들어갈 멀티라인 문자열로 직렬화. */
function formatHistoriesForCell(
  histories: { version: string; date: string; comment: string; changerName: string }[],
): string {
  if (histories.length === 0) return "(이력 없음)";
  return histories
    .map((h) => `${h.version} (${h.date}) ${h.changerName} — ${h.comment || "-"}`)
    .join("\n");
}

function buildRequirementsSheet(wb: ExcelJS.Workbook, input: RequirementsDefExportInput): void {
  const ws = wb.addWorksheet("요구사항");

  // 컬럼 정의 — 옵션에 따라 일부 컬럼이 비어 있을 수 있음.
  // 단, 컬럼 정의는 항상 동일하게 유지해 사용자가 같은 양식으로 비교 가능.
  ws.columns = [
    { header: "No",         key: "no",          width:  5 },
    { header: "요구사항 ID", key: "displayId",   width: 14 },
    { header: "요구사항명",  key: "name",        width: 30 },
    { header: "상위 과업",   key: "task",        width: 20 },
    { header: "우선순위",   key: "priority",    width: 10 },
    { header: "출처",       key: "source",      width: 10 },
    { header: "RFP",        key: "rfp",         width:  8 },
    { header: "담당자",     key: "assignee",    width: 14 },
    { header: "정렬",       key: "sortOrder",   width:  6 },
    { header: "변경여부",   key: "modified",    width:  9 },
    { header: "현행본",     key: "currentText", width: 60 },
    { header: "원본",       key: "originalText", width: 60 },
    { header: "변경이력",   key: "histories",   width: 50 },
  ];
  applyHeaderStyle(ws.getRow(1));
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 3 }]; // 첫 행 + 첫 3열 고정

  if (input.requirements.length === 0) {
    const r = ws.addRow(["-", "-", "(등록된 요구사항이 없습니다.)", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-"]);
    r.alignment = { vertical: "middle", horizontal: "center" };
    applyDataRowBorder(r);
    return;
  }

  input.requirements.forEach((r, i) => {
    const row = ws.addRow({
      no:           i + 1,
      displayId:    r.displayId,
      name:         r.name,
      task:         r.parentTaskName,
      priority:     r.priorityLabel,
      source:       r.sourceLabel,
      rfp:          r.rfpPage || "-",
      assignee:     r.assigneeName,
      sortOrder:    r.sortOrder,
      modified:     r.wasModified ? "수정됨" : "-",
      // HTML/이미지 → plain text 로 변환해 셀에 넣음
      currentText:  htmlToPlainText(r.currentContent) || "-",
      originalText: r.originalContent !== undefined
        ? (htmlToPlainText(r.originalContent) || "-")
        : (input.includeOriginal ? "(변경 없음)" : "-"),
      histories:    r.histories !== undefined
        ? formatHistoriesForCell(r.histories)
        : "-",
    });
    row.alignment = { vertical: "top", wrapText: true };
    // 자동 높이 조정 — wrapText 가 켜져 있어 ExcelJS 가 콘텐츠 길이에 따라 알아서 늘림.
    // 단, 너무 짧으면 한 줄로만 보이므로 최소 높이 보장.
    row.height = 30;
    applyDataRowBorder(row);

    // No / RQ-ID / 우선순위 / 출처 / RFP / 정렬 / 변경여부 — 가운데 정렬
    [1, 2, 5, 6, 7, 9, 10].forEach((colIdx) => {
      row.getCell(colIdx).alignment = { vertical: "top", horizontal: "center", wrapText: true };
    });
  });

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to:   { row: 1, column: 13 },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  메인
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 요구사항 정의서 xlsx 파일 Buffer 를 만든다.
 *
 * @param input  docx 빌더와 동일한 입력 구조 — 옵션은 input 에 이미 반영
 */
export async function buildRequirementsDefXlsx(
  input: RequirementsDefExportInput,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator        = "SPECODE";
  wb.title          = `${input.projectName} 요구사항 정의서`;
  wb.created        = new Date();
  wb.lastModifiedBy = "SPECODE";

  buildCoverSheet(wb, input);
  buildHistorySheet(wb, input);
  buildRequirementsSheet(wb, input);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
