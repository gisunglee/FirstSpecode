/**
 * exports/xlsx/task-matrix.ts — 과업대비표 xlsx 빌더
 *
 * 시트 구성:
 *   1) "표지"      — 프로젝트 메타 + 산출물 정보
 *   2) "반영 현황" — 전체/반영/미반영 과업 요약 + 산출물 발행 이력
 *   3) "과업대비표" — 과업 ↔ 요구사항 매핑 매트릭스 (과업 컬럼 세로병합)
 *
 * 레이아웃(과업대비표 시트):
 *   - "과업 모드" — 과업이 요구사항 N개를 가지면 과업 컬럼(ID/명/RFP/본문/매핑/반영/산출물)을
 *     요구사항 행 수만큼 세로 병합(mergeCells)하고, 요구사항 컬럼만 행마다 채운다.
 *   - 미반영 과업(요구사항 0건)은 1행 — 요구사항 칸은 "-".
 *   (사용자 합의: Excel=세로병합 / Word=평면 반복)
 *
 * 데이터 소스:
 *   - docx 빌더와 동일한 TaskMatrixExportInput 사용. 옵션도 input 에 이미 반영됨.
 *
 * 책임 분리:
 *   - 데이터 매핑 : task-matrix-data.ts (docx 와 공유)
 *   - 본 모듈     : input → xlsx Buffer (양식 "구성"만)
 */

import ExcelJS from "exceljs";
import type { TaskMatrixExportInput } from "@/lib/exports/docx/task-matrix";
import { htmlToPlainText } from "@/lib/exports/docx/html";
import { docMetaCoverRows } from "@/lib/exports/doc-meta";

// ═══════════════════════════════════════════════════════════════════════════
//  스타일 상수 — 요구사항 정의서 xlsx 와 동일 톤 (docx 헤더 #1F4E79 와 일치)
// ═══════════════════════════════════════════════════════════════════════════

const HEADER_FILL_COLOR = "FF1F4E79";
const HEADER_FONT_COLOR = "FFFFFFFF";

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

/** 셀 하나에 얇은 보더 적용 (병합 셀은 시작 셀에만 줘도 전체 적용됨) */
function applyCellBorder(cell: ExcelJS.Cell): void {
  cell.border = {
    top:    { style: "thin", color: { argb: "FFBFBFBF" } },
    bottom: { style: "thin", color: { argb: "FFBFBFBF" } },
    left:   { style: "thin", color: { argb: "FFBFBFBF" } },
    right:  { style: "thin", color: { argb: "FFBFBFBF" } },
  };
}

function applyLabelCellStyle(cell: ExcelJS.Cell): void {
  cell.font      = { bold: true };
  cell.alignment = { vertical: "middle", horizontal: "center" };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD9E2F3" },
  };
  applyCellBorder(cell);
}

function applyValueCellStyle(cell: ExcelJS.Cell): void {
  cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  applyCellBorder(cell);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Sheet 1 — 표지
// ═══════════════════════════════════════════════════════════════════════════

function buildCoverSheet(wb: ExcelJS.Workbook, input: TaskMatrixExportInput): void {
  const ws = wb.addWorksheet("표지", {
    views: [{ showGridLines: false }],
    properties: { tabColor: { argb: HEADER_FILL_COLOR } },
  });

  // 가로는 페이지 정중앙. 세로는 명시적 여백으로 위치 제어(verticalCentered 끔) —
  // 그래야 타이틀(상단 여백)과 메타표(간격)를 따로 올리고 내릴 수 있다.
  ws.pageSetup.horizontalCentered = true;
  ws.pageSetup.verticalCentered   = false;

  ws.columns = [
    { width: 18 },
    { width: 42 },
  ];

  // 상단 여백 — 타이틀의 세로 위치 결정 (작을수록 타이틀이 위로).
  for (let i = 0; i < 8; i++) ws.addRow([]);

  const projRow = ws.addRow([input.projectName]);
  ws.mergeCells(projRow.number, 1, projRow.number, 2);
  projRow.font = { size: 16, bold: true };
  projRow.alignment = { vertical: "middle", horizontal: "center" };
  projRow.height = 30;

  const titleRow = ws.addRow(["과업대비표"]);
  ws.mergeCells(titleRow.number, 1, titleRow.number, 2);
  titleRow.font = { size: 28, bold: true, color: { argb: HEADER_FILL_COLOR } };
  titleRow.alignment = { vertical: "middle", horizontal: "center" };
  titleRow.height = 60;

  const optionTags = [
    input.includeTaskContent ? "과업본문 포함" : null,
    input.includeReqContent  ? "요구사항본문 포함" : null,
  ].filter(Boolean).join(" · ");
  const subtitle = optionTags
    ? `과업 ${input.summary.totalTasks}건  (${optionTags})`
    : `과업 ${input.summary.totalTasks}건`;
  const subtitleRow = ws.addRow([subtitle]);
  ws.mergeCells(subtitleRow.number, 1, subtitleRow.number, 2);
  subtitleRow.font = { size: 14, bold: true };
  subtitleRow.alignment = { vertical: "middle", horizontal: "center" };
  subtitleRow.height = 22;

  // 제목 블록과 메타표 사이 간격 — 메타표의 세로 위치 결정 (클수록 메타표가 더 아래로).
  for (let i = 0; i < 15; i++) ws.addRow([]);

  // 시스템명/단계/활동/작업/문서번호 (docx 표지와 통일).
  // 작성일/문서버전/작성자/승인자는 "변경 이력" 시트에 있어 표지에선 생략 (중복 제거).
  const metaRows: [string, string][] = docMetaCoverRows(input.docMeta, { includeDocNo: true });
  for (const [label, value] of metaRows) {
    const r = ws.addRow([label, value]);
    applyLabelCellStyle(r.getCell(1));
    applyValueCellStyle(r.getCell(2));
    r.height = 20;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Sheet 2 — 발행 이력
// ═══════════════════════════════════════════════════════════════════════════

function buildReleaseSheet(wb: ExcelJS.Workbook, input: TaskMatrixExportInput): void {
  const ws = wb.addWorksheet("발행 이력");
  // 변경 내용은 넓게, 작성자/승인자는 좁게.
  ws.columns = [
    { width: 12 },  // 버전
    { width: 14 },  // 작성일
    { width: 60 },  // 변경 내용 (넓게)
    { width: 14 },  // 작성자 (좁게)
    { width: 14 },  // 승인자 (좁게)
  ];

  const headerRow = ws.addRow(["버전", "작성일", "변경 내용", "작성자", "승인자"]);
  applyHeaderStyle(headerRow);

  if (input.history.length === 0) {
    const r = ws.addRow(["-", "-", "(이력 없음)", "-", "-"]);
    r.alignment = { vertical: "middle", horizontal: "center" };
    r.eachCell({ includeEmpty: true }, applyCellBorder);
  } else {
    for (const h of input.history) {
      const r = ws.addRow([h.version, h.date, h.change, h.author, h.approver]);
      r.alignment = { vertical: "middle", wrapText: true };
      r.eachCell({ includeEmpty: true }, applyCellBorder);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Sheet 3 — 과업대비표 (과업 컬럼 세로병합)
// ═══════════════════════════════════════════════════════════════════════════

/** 과업본문/요구사항본문 셀 값 — 원본(HTML/마크다운)을 평문으로 변환, 빈 값이면 "-". */
function cellText(text: string | undefined): string {
  const t = htmlToPlainText(text).trim();
  return t || "-";
}

function buildMatrixSheet(wb: ExcelJS.Workbook, input: TaskMatrixExportInput): void {
  const ws = wb.addWorksheet("과업대비표");

  // 컬럼 정의 — 옵션 컬럼은 ON 일 때만 포함. (key 로 셀 접근)
  type ColDef = { header: string; key: string; width: number };
  const cols: ColDef[] = [
    { header: "No",         key: "no",          width:  5 },
    { header: "과업 ID",     key: "taskId",      width: 14 },
    { header: "과업명",      key: "taskNm",      width: 26 },
    { header: "RFP 출처",    key: "rfp",         width: 14 },
    ...(input.includeTaskContent
      ? [{ header: "과업 본문", key: "taskContent", width: 50 } as ColDef] : []),
    { header: "매핑유형",    key: "mapping",     width: 10 },
    { header: "반영여부",    key: "reflect",     width: 10 },
    { header: "관련 산출물",  key: "output",      width: 24 },
    { header: "요구사항 ID",  key: "reqId",       width: 14 },
    { header: "요구사항명",   key: "reqNm",       width: 26 },
    ...(input.includeReqContent
      ? [{ header: "요구사항 내용", key: "reqContent", width: 50 } as ColDef] : []),
  ];
  ws.columns = cols;
  applyHeaderStyle(ws.getRow(1));
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 3 }]; // 첫 행 + 과업 ID/명까지 고정

  // 과업 컬럼(세로병합 대상) key 목록 — 요구사항 컬럼은 행마다 다르므로 병합 X
  const taskColKeys = ["no", "taskId", "taskNm", "rfp", "mapping", "reflect", "output",
    ...(input.includeTaskContent ? ["taskContent"] : [])];
  // key → 컬럼 번호(1-based) 매핑 (mergeCells 좌표 계산용)
  const colNumByKey = new Map<string, number>();
  cols.forEach((c, i) => colNumByKey.set(c.key, i + 1));

  if (input.tasks.length === 0) {
    const r = ws.addRow({ taskNm: "(등록된 과업이 없습니다.)" });
    r.alignment = { vertical: "middle", horizontal: "center" };
    r.eachCell({ includeEmpty: true }, applyCellBorder);
    return;
  }

  let rowNo = 1;
  for (const t of input.tasks) {
    const reqList = t.requirements.length > 0 ? t.requirements : [null];
    const startRowNum = ws.rowCount + 1; // 이 과업 블록의 첫 데이터 행 번호

    reqList.forEach((req, idx) => {
      const r = ws.addRow({
        no:          idx === 0 ? rowNo : null, // 과업 단위 번호 — 첫 행에만, 나머지는 병합으로 가려짐
        taskId:      t.taskDisplayId,
        taskNm:      t.taskName || "-",
        rfp:         t.rfpSource || "-",
        taskContent: input.includeTaskContent ? cellText(t.taskContent) : undefined,
        mapping:     t.mappingType,
        reflect:     t.reflectStatus,
        output:      t.outputInfo || "-",
        reqId:       req?.reqDisplayId ?? "-",
        reqNm:       req?.reqName || "-",
        reqContent:  input.includeReqContent ? cellText(req?.reqContent) : undefined,
      });
      r.alignment = { vertical: "top", wrapText: true };
      r.height = 28;
      r.eachCell({ includeEmpty: true }, applyCellBorder);

      // 가운데 정렬 — No / 과업ID / RFP / 매핑 / 반영 / 요구사항ID
      ["no", "taskId", "rfp", "mapping", "reflect", "reqId"].forEach((key) => {
        const colNum = colNumByKey.get(key);
        if (colNum) r.getCell(colNum).alignment = { vertical: "top", horizontal: "center", wrapText: true };
      });
    });

    const endRowNum = ws.rowCount;

    // 요구사항 2건 이상이면 과업 컬럼을 세로병합 — "과업 모드" 외관
    if (endRowNum > startRowNum) {
      // 짧은 코드성 컬럼만 가운데, 이름/본문/산출물은 좌측 정렬 (비병합 행과 통일)
      const centerKeys = new Set(["no", "taskId", "rfp", "mapping", "reflect"]);
      for (const key of taskColKeys) {
        const colNum = colNumByKey.get(key);
        if (!colNum) continue;
        ws.mergeCells(startRowNum, colNum, endRowNum, colNum);
        ws.getCell(startRowNum, colNum).alignment = {
          vertical:   "middle",
          horizontal: centerKeys.has(key) ? "center" : "left",
          wrapText:   true,
        };
      }
    }

    rowNo += 1;
  }

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to:   { row: 1, column: cols.length },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  메인
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 과업대비표 xlsx 파일 Buffer 를 만든다.
 *
 * @param input  docx 빌더와 동일한 입력 구조 — 옵션은 input 에 이미 반영
 */
export async function buildTaskMatrixXlsx(
  input: TaskMatrixExportInput,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator        = "SPECODE";
  wb.title          = `${input.projectName} 과업대비표`;
  wb.created        = new Date();
  wb.lastModifiedBy = "SPECODE";

  buildCoverSheet(wb, input);
  buildReleaseSheet(wb, input);
  buildMatrixSheet(wb, input);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
