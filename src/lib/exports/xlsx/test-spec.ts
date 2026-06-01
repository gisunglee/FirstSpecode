/**
 * exports/xlsx/test-spec.ts — 단위/통합 테스트 명세서 xlsx 빌더
 *
 * 시트 구성:
 *   1) "표지"        — 프로젝트 메타 + 명세서 기본 정보
 *   2) "변경 이력"    — 명세서 자체에는 발행 이력이 없으므로 안내 행만
 *   3) "테스트케이스" — 사용자 운영 템플릿 형태:
 *        상단 박스(프로그램ID / 테스트 업무명 / 부제목)
 *        공통 Checklist 표
 *        기능 테스트케이스 표
 *   4) "증적"        — 추후 구현 예정 안내 (Phase 4)
 *
 * 결과 매핑:
 *   - 최신 회차(round_no 최대) 1개의 결과를 사용 — 사용자 템플릿이 1회차 컬럼 구조
 *   - PASS → "적합", FAIL → "부적합", NA → "N/A", BLOCKED → "차단"
 *
 * 결함 매핑:
 *   - 결함내역: 결함이 N개면 "1. ... 2. ..." 형태로 한 셀에 줄바꿈으로 join
 *   - 조치일자/조치결과: 조치(fix_dt/fix_cn) 가 있는 첫 결함의 값을 표시
 *     (사용자 템플릿이 1조치 컬럼이라 단순화. 향후 다건 매핑은 별도 시트로 분리 검토)
 *
 * 책임 분리:
 *   - 데이터 매핑 : route.ts 에서 직접 (현재 명세서 1건 = 단순 구조라 별도 data 모듈 안 만듦)
 *   - 본 모듈    : input → xlsx Buffer (양식 출력만)
 */

import ExcelJS from "exceljs";

// ═══════════════════════════════════════════════════════════════════════════
//  Input 타입
// ═══════════════════════════════════════════════════════════════════════════

export type TestSpecXlsxCase = {
  no:          number;
  /** Checklist 의 "구분" / 기능 테스트의 "CASE 명" — null/빈 가능 */
  group:       string | null;
  /** 시나리오(checklist 명 / 테스트 내용) */
  scenario:    string;
  /** 예상 결과 — 기능 시나리오 전용. checklist 는 빈 문자열 보내도 무방. */
  expected:    string;
  /** 'YYYY-MM-DD' 또는 빈 문자열 */
  testedDate:  string;
  /** "적합" | "부적합" | "N/A" | "차단" | 빈 문자열 (해당없음) */
  resultLabel: string;
  /** 결함 본문 — 여러 결함은 줄바꿈으로 결합 */
  defectText:  string;
  /** 조치일자 'YYYY-MM-DD' 또는 빈 문자열 */
  fixDate:     string;
  /** 조치 결과 본문 또는 빈 문자열 */
  fixResult:   string;
};

/**
 * 문서 종류 — 한 명세서에서 두 시점의 산출물이 나옴.
 *   - "spec"   : 명세서 (설계 시점, 결과/결함/조치 컬럼 없음)
 *   - "result" : 결과서 (구현 시점, 결과/결함/조치 컬럼 포함)
 *
 * 단계 라벨은 docKind 에서 자동 매핑(설계/구현). 표지의 시트 타이틀에도 반영.
 */
export type TestSpecDocKind = "spec" | "result";

export type TestSpecXlsxInput = {
  docKind:        TestSpecDocKind;   // 명세서/결과서 구분
  // 표지·헤더용
  projectName:    string;
  /** 프로젝트 약어 — 표지 상단 "프로젝트명 [ABBR]" 표시. 없으면 칩 생략. */
  projectAbbr?:   string | null;
  displayId:      string;            // TS-00003
  testSpecNm:     string;
  testKindLabel:  string;            // "단위 테스트" | "통합 테스트" — 종류 (UNIT/INTEGRATION)

  // 운영 템플릿 상단 박스
  programIds:     string;            // 연결 단위업무 displayId 들을 ", " join
  testTaskNm:     string;            // 보통 testSpecNm 과 동일
  subtitle:       string;            // 연결 단위업무 이름들 ", " join

  // 본문
  checklist:      TestSpecXlsxCase[];
  functional:     TestSpecXlsxCase[];
};

// docKind → 단계 라벨
function stageLabel(kind: TestSpecDocKind): string {
  return kind === "spec" ? "설계" : "구현";
}
// docKind → 문서 종류 한글명 ("… 명세서" / "… 결과서")
function docFullTitle(input: TestSpecXlsxInput): string {
  return `${input.testKindLabel} ${input.docKind === "spec" ? "명세서" : "결과서"}`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  스타일 — requirements-def 빌더와 동일 톤 (헤더 짙은 청, 라벨 연청)
// ═══════════════════════════════════════════════════════════════════════════

const HEADER_FILL_COLOR = "FF1F4E79";
const HEADER_FONT_COLOR = "FFFFFFFF";
const LABEL_FILL_COLOR  = "FFD9E2F3";

function applyHeaderRow(row: ExcelJS.Row, fromCol: number, toCol: number): void {
  row.height = 22;
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  for (let c = fromCol; c <= toCol; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: HEADER_FONT_COLOR } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL_COLOR } };
    cell.border = thinBorder("FF808080");
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  }
}

function applyDataBorder(row: ExcelJS.Row, fromCol: number, toCol: number): void {
  for (let c = fromCol; c <= toCol; c++) {
    row.getCell(c).border = thinBorder("FFBFBFBF");
  }
}

function thinBorder(argb: string): Partial<ExcelJS.Borders> {
  return {
    top:    { style: "thin", color: { argb } },
    bottom: { style: "thin", color: { argb } },
    left:   { style: "thin", color: { argb } },
    right:  { style: "thin", color: { argb } },
  };
}

function applyLabelCell(cell: ExcelJS.Cell): void {
  cell.font   = { bold: true };
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LABEL_FILL_COLOR } };
  cell.border = thinBorder("FFBFBFBF");
}
function applyValueCell(cell: ExcelJS.Cell): void {
  cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  cell.border = thinBorder("FFBFBFBF");
}

// ═══════════════════════════════════════════════════════════════════════════
//  Sheet 1 — 표지
// ═══════════════════════════════════════════════════════════════════════════

function buildCoverSheet(wb: ExcelJS.Workbook, input: TestSpecXlsxInput): void {
  const ws = wb.addWorksheet("표지", {
    views: [{ showGridLines: false }],
    properties: { tabColor: { argb: HEADER_FILL_COLOR } },
  });
  // 라벨/값 두 컬럼 — 값 컬럼은 사람 이름·프로젝트명 길이 고려해 넉넉히
  ws.columns = [{ width: 18 }, { width: 64 }];

  ws.addRow([]); ws.addRow([]);

  // 표지 상단: "프로젝트명  [ABBR]" — 약어 미설정 시 칩 생략
  const projTitle = input.projectAbbr
    ? `${input.projectName}  [${input.projectAbbr}]`
    : input.projectName;
  const projRow = ws.addRow([projTitle]);
  ws.mergeCells(projRow.number, 1, projRow.number, 2);
  projRow.font = { size: 16, bold: true };
  projRow.alignment = { vertical: "middle", horizontal: "center" };
  projRow.height = 30;

  const titleRow = ws.addRow([docFullTitle(input)]);
  ws.mergeCells(titleRow.number, 1, titleRow.number, 2);
  titleRow.font = { size: 28, bold: true, color: { argb: HEADER_FILL_COLOR } };
  titleRow.alignment = { vertical: "middle", horizontal: "center" };
  titleRow.height = 60;

  const subRow = ws.addRow([`${input.displayId} · ${input.testSpecNm}`]);
  ws.mergeCells(subRow.number, 1, subRow.number, 2);
  subRow.font = { size: 14, bold: true };
  subRow.alignment = { vertical: "middle", horizontal: "center" };
  subRow.height = 22;

  for (let i = 0; i < 6; i++) ws.addRow([]);

  // 메타 표 — 사용자 운영 양식에 맞춰 3행만.
  // 단계는 docKind 에서 자동 매핑 — 명세서=설계, 결과서=구현.
  const metaRows: [string, string][] = [
    ["시스템 명",  input.projectName],
    ["단계",      stageLabel(input.docKind)],
    ["테스트 ID", input.displayId],
  ];
  for (const [label, value] of metaRows) {
    const r = ws.addRow([label, value]);
    applyLabelCell(r.getCell(1));
    applyValueCell(r.getCell(2));
    r.height = 22;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Sheet 2 — 변경 이력 (현재는 안내만)
// ═══════════════════════════════════════════════════════════════════════════

function buildHistorySheet(wb: ExcelJS.Workbook): void {
  const ws = wb.addWorksheet("변경 이력");
  ws.columns = [
    { header: "버전",      key: "version",  width: 10 },
    { header: "작성일",    key: "date",     width: 14 },
    { header: "변경 내용", key: "change",   width: 50 },
    { header: "작성자",    key: "author",   width: 16 },
    { header: "승인자",    key: "approver", width: 16 },
  ];
  applyHeaderRow(ws.getRow(1), 1, 5);

  // 명세서 자체에는 현재 발행 이력 모델이 없어 안내 1행만
  const r = ws.addRow(["-", "-", "(테스트 명세서 발행 이력은 추후 지원 예정)", "-", "-"]);
  r.alignment = { vertical: "middle", horizontal: "center" };
  applyDataBorder(r, 1, 5);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Sheet 3 — 테스트케이스 (운영 템플릿 형태)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 컬럼 매핑 (A 는 좌측 margin) — 총 11 컬럼 (A..K)
 *
 *   A: margin
 *   B: No
 *   C: 구분 / CASE 명
 *   D: Checklist 명 / 테스트 내용
 *   E: 예상 결과 (Checklist 는 D 와 merge 해서 비움)
 *   F: Check 일자 / 테스트 일자
 *   G: Check 결과 / 테스트 결과
 *   H: 결함내역
 *   I: 조치일자
 *   J: 조치결과
 *   K: 여분(시각 정리용)
 */
const COL = {
  margin: 1,
  no:     2,
  group:  3,
  desc:   4,
  exp:    5,
  date:   6,
  result: 7,
  defect: 8,
  fixDt:  9,
  fixRs:  10,
  tail:   11,
} as const;

function buildCasesSheet(wb: ExcelJS.Workbook, input: TestSpecXlsxInput): void {
  // views.state 를 "frozen" 으로 두면서 ySplit/xSplit 이 둘 다 0 이면
  // Excel 이 잘못된 pane XML 로 인식해 "보기 부분 복구" 다이얼로그가 뜸.
  // 고정 불필요하므로 단순히 grid line 만 끄는 형태로 통일.
  const ws = wb.addWorksheet("테스트케이스", {
    views: [{ showGridLines: false }],
  });

  // docKind 가 "spec" 이면 결과·결함·조치 컬럼은 표시도 안 함 — 명세 시점 산출물의 깔끔함 유지.
  // 마지막 데이터 컬럼 인덱스(rightCol) 를 분기해 헤더/머지/데이터 행 범위를 일괄 결정.
  const isResult = input.docKind === "result";
  const rightCol = isResult ? COL.fixRs : COL.exp;  // 명세서: 예상결과까지 / 결과서: 조치결과까지

  // 컬럼 폭 — 명세서일 때 본문 컬럼을 좀 더 넓게
  ws.getColumn(COL.margin).width =  2;
  ws.getColumn(COL.no    ).width =  8;
  ws.getColumn(COL.group ).width = 14;
  ws.getColumn(COL.desc  ).width = isResult ? 38 : 50;
  ws.getColumn(COL.exp   ).width = isResult ? 28 : 38;
  ws.getColumn(COL.date  ).width = 14;
  ws.getColumn(COL.result).width = 13;
  ws.getColumn(COL.defect).width = 28;
  ws.getColumn(COL.fixDt ).width = 13;
  ws.getColumn(COL.fixRs ).width = 24;
  ws.getColumn(COL.tail  ).width =  2;

  // ── 상단 박스 영역 — 라벨(B-C) + 값(D-rightCol) 2분할 통일 ──────────
  // 이전에는 결과서(rightCol=10) 기준 4분할이었으나 명세서(rightCol=5) 일 때 컬럼이
  // 부족해 머지 충돌이 발생. 모드 분기 없이 단순한 라벨/값 표 3행으로 통일.
  ws.addRow([]); // margin

  type LabelValue = [string, string];
  const boxRows: LabelValue[] = [
    ["프로그램 ID",  input.programIds || "-"],
    ["테스트 업무명", input.subtitle   || "-"],
    [`테스트 ${input.docKind === "spec" ? "명세서명" : "결과서명"}`,
                    `${input.displayId} · ${input.testTaskNm}`],
  ];
  for (const [label, value] of boxRows) {
    const r = ws.addRow([]);
    r.getCell(COL.no  ).value = label;
    r.getCell(COL.desc).value = value;
    ws.mergeCells(r.number, COL.no,   r.number, COL.group);
    ws.mergeCells(r.number, COL.desc, r.number, rightCol);
    applyLabelCell(r.getCell(COL.no));
    applyValueCell(r.getCell(COL.desc));
    r.height = 24;
  }

  ws.addRow([]); // 빈 줄 — 박스와 표 사이 여백

  // ── 공통 Checklist 섹션 ──────────────────────────────────────────────
  const checklistTitleRow = ws.addRow([]);
  checklistTitleRow.getCell(COL.no).value = "공통 Checklist";
  ws.mergeCells(checklistTitleRow.number, COL.no, checklistTitleRow.number, rightCol);
  const titleCell = checklistTitleRow.getCell(COL.no);
  titleCell.font = { bold: true, size: 12, color: { argb: HEADER_FONT_COLOR } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL_COLOR } };
  titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  checklistTitleRow.height = 22;

  // Checklist 헤더 행 — Checklist 명은 D-E 합쳐서 넓게. 결과/결함/조치는 결과서일 때만.
  const chkHeader = ws.addRow([]);
  chkHeader.getCell(COL.no    ).value = "No";
  chkHeader.getCell(COL.group ).value = "구분";
  chkHeader.getCell(COL.desc  ).value = "Checklist 명";
  if (isResult) {
    chkHeader.getCell(COL.date  ).value = "Check 일자";
    chkHeader.getCell(COL.result).value = "Check 결과";
    chkHeader.getCell(COL.defect).value = "결함내역";
    chkHeader.getCell(COL.fixDt ).value = "조치일자";
    chkHeader.getCell(COL.fixRs ).value = "조치결과";
  }
  ws.mergeCells(chkHeader.number, COL.desc, chkHeader.number, COL.exp);
  applyHeaderRow(chkHeader, COL.no, rightCol);

  // Checklist 데이터 행
  if (input.checklist.length === 0) {
    const r = ws.addRow([]);
    r.getCell(COL.no).value = "-";
    r.getCell(COL.desc).value = "(공통 Checklist 항목이 없습니다.)";
    ws.mergeCells(r.number, COL.desc, r.number, rightCol);
    r.alignment = { vertical: "middle", horizontal: "center" };
    applyDataBorder(r, COL.no, rightCol);
  } else {
    for (const c of input.checklist) {
      const r = ws.addRow([]);
      r.getCell(COL.no    ).value = c.no;
      r.getCell(COL.group ).value = c.group ?? "";
      r.getCell(COL.desc  ).value = c.scenario;
      if (isResult) {
        r.getCell(COL.date  ).value = c.testedDate;
        r.getCell(COL.result).value = c.resultLabel;
        r.getCell(COL.defect).value = c.defectText;
        r.getCell(COL.fixDt ).value = c.fixDate;
        r.getCell(COL.fixRs ).value = c.fixResult;
      }
      ws.mergeCells(r.number, COL.desc, r.number, COL.exp);
      r.alignment = { vertical: "middle", wrapText: true };
      // 가운데 정렬: 번호·구분·일자·결과·조치일자
      [COL.no, COL.group, COL.date, COL.result, COL.fixDt].forEach((c2) => {
        if (c2 <= rightCol) r.getCell(c2).alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      });
      // 본문 컬럼은 좌측 정렬
      [COL.desc, COL.defect, COL.fixRs].forEach((c2) => {
        if (c2 <= rightCol) r.getCell(c2).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      });
      applyDataBorder(r, COL.no, rightCol);
    }
  }

  ws.addRow([]); // 섹션 사이 여백

  // ── 기능 테스트케이스 섹션 ──────────────────────────────────────────
  const funcTitleRow = ws.addRow([]);
  funcTitleRow.getCell(COL.no).value = "기능 테스트케이스";
  ws.mergeCells(funcTitleRow.number, COL.no, funcTitleRow.number, rightCol);
  const funcTitleCell = funcTitleRow.getCell(COL.no);
  funcTitleCell.font = { bold: true, size: 12, color: { argb: HEADER_FONT_COLOR } };
  funcTitleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL_COLOR } };
  funcTitleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  funcTitleRow.height = 22;

  // 기능 헤더 행 — 결과서일 때만 결과/결함/조치 컬럼 추가
  const fnHeader = ws.addRow([]);
  fnHeader.getCell(COL.no    ).value = "No";
  fnHeader.getCell(COL.group ).value = "CASE 명";
  fnHeader.getCell(COL.desc  ).value = "테스트 내용";
  fnHeader.getCell(COL.exp   ).value = "예상 결과";
  if (isResult) {
    fnHeader.getCell(COL.date  ).value = "테스트 일자";
    fnHeader.getCell(COL.result).value = "테스트 결과";
    fnHeader.getCell(COL.defect).value = "결함내역";
    fnHeader.getCell(COL.fixDt ).value = "조치일자";
    fnHeader.getCell(COL.fixRs ).value = "조치결과";
  }
  applyHeaderRow(fnHeader, COL.no, rightCol);

  if (input.functional.length === 0) {
    const r = ws.addRow([]);
    r.getCell(COL.no).value = "-";
    r.getCell(COL.desc).value = "(기능 테스트케이스가 없습니다.)";
    ws.mergeCells(r.number, COL.desc, r.number, rightCol);
    r.alignment = { vertical: "middle", horizontal: "center" };
    applyDataBorder(r, COL.no, rightCol);
  } else {
    for (const c of input.functional) {
      const r = ws.addRow([]);
      r.getCell(COL.no    ).value = c.no;
      r.getCell(COL.group ).value = c.group ?? "";
      r.getCell(COL.desc  ).value = c.scenario;
      r.getCell(COL.exp   ).value = c.expected;
      if (isResult) {
        r.getCell(COL.date  ).value = c.testedDate;
        r.getCell(COL.result).value = c.resultLabel;
        r.getCell(COL.defect).value = c.defectText;
        r.getCell(COL.fixDt ).value = c.fixDate;
        r.getCell(COL.fixRs ).value = c.fixResult;
      }
      r.alignment = { vertical: "middle", wrapText: true };
      [COL.no, COL.date, COL.result, COL.fixDt].forEach((c2) => {
        if (c2 <= rightCol) r.getCell(c2).alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      });
      [COL.group, COL.desc, COL.exp, COL.defect, COL.fixRs].forEach((c2) => {
        if (c2 <= rightCol) r.getCell(c2).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      });
      applyDataBorder(r, COL.no, rightCol);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Sheet 4 — 증적 (Phase 4 예정)
// ═══════════════════════════════════════════════════════════════════════════

function buildEvidenceSheet(wb: ExcelJS.Workbook): void {
  const ws = wb.addWorksheet("증적", { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 60 }];
  ws.addRow([]); ws.addRow([]);
  const r = ws.addRow(["증적(스크린샷·로그) 첨부 기능은 추후 지원 예정입니다."]);
  r.font = { italic: true, color: { argb: "FF808080" } };
  r.alignment = { vertical: "middle", horizontal: "center" };
  r.height = 24;
}

// ═══════════════════════════════════════════════════════════════════════════
//  메인
// ═══════════════════════════════════════════════════════════════════════════

export async function buildTestSpecXlsx(input: TestSpecXlsxInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator        = "SPECODE";
  wb.title          = `${input.projectName} ${docFullTitle(input)}`;
  wb.created        = new Date();
  wb.lastModifiedBy = "SPECODE";

  buildCoverSheet(wb, input);
  buildHistorySheet(wb);
  buildCasesSheet(wb, input);
  // 증적 시트는 결과서일 때만 의미 있음 (명세 시점에는 증적이 없음)
  if (input.docKind === "result") buildEvidenceSheet(wb);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
