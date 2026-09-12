/**
 * exports/xlsx/test-spec.ts — 단위/통합 테스트 명세서·결과서 xlsx 빌더
 *
 * 시트 구성:
 *   명세서(docKind="spec")
 *     1) "표지"        — 프로젝트 메타 + 명세서 기본 정보
 *     2) "변경 이력"    — 명세서 자체에는 발행 이력이 없으므로 안내 행만
 *     3) "테스트케이스" — 상단 박스 + 공통 Checklist 표 + 기능 테스트케이스 표
 *
 *   결과서(docKind="result") — 위 3개 + 회차 구조
 *     2) "변경 이력"    — 수행한 회차 목록(환경·빌드·기간·건수·집계)
 *     3) "테스트케이스" — 명세 + 회차별 판정만 옆으로 붙인 **전체 조망**
 *     4) "1차 결과" ..  — 회차마다 1시트. 결과·결함·조치 상세
 *     N) "증적"        — 추후 구현 예정 안내 (Phase 4)
 *
 * 회차를 시트로 나누는 이유:
 *   회차별 결과를 케이스 표에 가로로 계속 붙이면 결함·조치 컬럼까지 회차 수만큼
 *   늘어나 표가 망가진다. 판정(적합/부적합)만 조망 시트에 가로로 두고, 상세는
 *   회차별 시트로 내리면 회차가 늘어도 시트만 늘고 표 구조는 그대로다.
 *   파일을 회차 수만큼 쪼개지 않는 이유는 감리 제출 시 산출물이 흩어지기 때문.
 *
 * 결과 매핑:
 *   - PASS → "적합", FAIL → "부적합", NA → "N/A", BLOCKED → "차단"
 *   - 회차 생성 시점 이후에 추가된 케이스는 그 회차에 결과 row 가 없다.
 *     회차 시트에는 그 회차가 실제로 다룬 케이스만 나오므로, 시트마다 건수가
 *     다를 수 있다 — 그래서 회차 시트 상단에 "대상 N건 / 명세 M건"을 표기한다.
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
  /**
   * 회차별 판정 라벨 — "테스트케이스"(전체 조망) 시트 전용.
   * input.rounds 와 같은 순서·같은 길이. 그 회차에 이 케이스의 결과가 없으면 ""
   * (회차 생성 이후에 추가된 케이스가 여기 해당한다).
   * 회차 상세 시트에서는 쓰지 않는다.
   */
  roundVerdicts?: string[];
};

/**
 * 테스트 회차 1건 — 결과서에서 시트 하나로 출력된다.
 *
 * checklist/functional 은 **그 회차가 실제로 다룬 케이스만** 담는다.
 * 회차 생성 후에 명세에 추가된 케이스는 결과 row 가 없으므로 여기 포함되지 않는다.
 */
export type TestSpecXlsxRound = {
  roundNo:     number;
  /** "DEV" | "STG" | "PROD" */
  envirLabel:  string;
  /** 빌드/커밋 버전 — 없으면 빈 문자열 */
  bldVrsnNm:   string;
  /** 'YYYY-MM-DD' 또는 빈 문자열 */
  bgngDate:    string;
  endDate:     string;
  /** "진행중" | "완료" */
  statusLabel: string;
  checklist:   TestSpecXlsxCase[];
  functional:  TestSpecXlsxCase[];
  /** 판정 집계 — 예: { 적합: 12, 부적합: 2, "N/A": 1 } */
  summary:     Record<string, number>;
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
  /** 표지 문서번호 (예: "GBMS_I501_003"). 없으면(문서코드 미설정) 표지에 문서번호 행 생략. */
  docNo?:         string;

  // 운영 템플릿 상단 박스
  programIds:     string;            // 연결 단위업무 displayId 들을 ", " join
  testTaskNm:     string;            // 보통 testSpecNm 과 동일
  subtitle:       string;            // 연결 단위업무 이름들 ", " join

  // 본문 — 명세 기준 전체 케이스 ("테스트케이스" 조망 시트의 행)
  checklist:      TestSpecXlsxCase[];
  functional:     TestSpecXlsxCase[];

  /**
   * 수행한 회차 목록 (round_no 오름차순).
   * docKind="spec" 이면 항상 빈 배열 — 명세 시점 산출물에는 결과가 없다.
   * 결과서인데 비어 있으면(회차 미생성) 회차 시트 없이 명세만 출력된다.
   */
  rounds:         TestSpecXlsxRound[];
};

/**
 * 회차 컬럼/행 라벨 — 최신 회차를 눈에 띄게 표시한다.
 * 회차가 여러 개인 결과서에서 "지금 유효한 결과가 어느 것인지" 가 가장 먼저
 * 필요한 정보라, 번호만으로 두지 않고 최신임을 붙여 준다.
 */
function roundLabel(roundNo: number, isLatest: boolean): string {
  return isLatest ? `${roundNo}차(최신)` : `${roundNo}차`;
}

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

  // 메타 표 — 사용자 운영 양식에 맞춰 시스템명/단계/테스트ID + (있으면)문서번호.
  // 단계는 docKind 에서 자동 매핑 — 명세서=설계, 결과서=구현.
  const metaRows: [string, string][] = [
    ["시스템 명",  input.projectName],
    ["단계",      stageLabel(input.docKind)],
    ["테스트 ID", input.displayId],
    // 문서번호는 프로젝트 설정(문서코드)이 있어야 생성됨 — 없으면 행 자체를 빼서 빈 칸 노출 방지
    ...(input.docNo ? [["문서번호", input.docNo] as [string, string]] : []),
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

/**
 * 명세서 — 발행 이력 모델이 없으므로 안내 1행.
 * 결과서 — 수행한 회차 목록을 이력으로 출력. "언제 어떤 환경/빌드로 몇 차를 돌렸나" 가
 *          결과서에서 실제로 필요한 이력이라, 빈 안내 행 대신 이 정보를 채운다.
 */
function buildHistorySheet(wb: ExcelJS.Workbook, input: TestSpecXlsxInput): void {
  // 명세 시점 — 회차 개념 자체가 없다
  if (input.docKind === "spec") {
    const ws = wb.addWorksheet("변경 이력");
    ws.columns = [
      { header: "버전",      key: "version",  width: 10 },
      { header: "작성일",    key: "date",     width: 14 },
      { header: "변경 내용", key: "change",   width: 50 },
      { header: "작성자",    key: "author",   width: 16 },
      { header: "승인자",    key: "approver", width: 16 },
    ];
    applyHeaderRow(ws.getRow(1), 1, 5);
    const r = ws.addRow(["-", "-", "(테스트 명세서 발행 이력은 추후 지원 예정)", "-", "-"]);
    r.alignment = { vertical: "middle", horizontal: "center" };
    applyDataBorder(r, 1, 5);
    return;
  }

  // 시트명은 "변경 이력" 그대로 유지 — 감리 제출 양식에서 자리가 정해진 시트라
  // 이름을 바꾸면 기존 산출물과 대조가 어긋난다. 내용만 회차 목록으로 채운다.
  const ws = wb.addWorksheet("변경 이력");
  ws.columns = [
    { header: "회차",      key: "round",   width: 10 },
    { header: "환경",      key: "envir",   width: 10 },
    { header: "빌드/버전", key: "build",   width: 22 },
    { header: "시작일",    key: "bgng",    width: 14 },
    { header: "종료일",    key: "end",     width: 14 },
    { header: "상태",      key: "status",  width: 10 },
    { header: "대상 건수", key: "count",   width: 12 },
    { header: "판정 집계", key: "summary", width: 40 },
  ];
  applyHeaderRow(ws.getRow(1), 1, 8);

  if (input.rounds.length === 0) {
    const r = ws.addRow(["-", "-", "(아직 수행한 회차가 없습니다.)", "-", "-", "-", "-", "-"]);
    r.alignment = { vertical: "middle", horizontal: "center" };
    applyDataBorder(r, 1, 8);
    return;
  }

  for (const rd of input.rounds) {
    const caseCount = rd.checklist.length + rd.functional.length;
    // 집계는 "적합 12 / 부적합 2" 형태로 한 셀에 — 건수 0 인 판정은 생략
    const summaryText = Object.entries(rd.summary)
      .filter(([, n]) => n > 0)
      .map(([label, n]) => `${label} ${n}`)
      .join(" / ");
    const r = ws.addRow([
      roundLabel(rd.roundNo, rd === input.rounds[input.rounds.length - 1]),
      rd.envirLabel,
      rd.bldVrsnNm || "-",
      rd.bgngDate  || "-",
      rd.endDate   || "-",
      rd.statusLabel,
      `${caseCount}건`,
      summaryText || "-",
    ]);
    r.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    // 빌드명·집계는 좌측 정렬 — 길어질 수 있는 텍스트
    r.getCell(3).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    r.getCell(8).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    applyDataBorder(r, 1, 8);
  }

  // 케이스가 회차 사이에 추가되면 회차마다 대상 건수가 달라진다 —
  // 엑셀만 보는 사람이 "왜 1차는 12건이고 2차는 15건인가" 를 오해하지 않도록 명시.
  ws.addRow([]);
  const noteRow = ws.addRow([
    `※ 명세 기준 전체 케이스는 ${input.checklist.length + input.functional.length}건입니다. ` +
    `회차별 대상 건수가 이보다 적으면, 그 회차를 시작한 뒤에 추가된 케이스가 있다는 뜻입니다.`,
  ]);
  ws.mergeCells(noteRow.number, 1, noteRow.number, 8);
  noteRow.getCell(1).font = { italic: true, size: 10, color: { argb: "FF808080" } };
  noteRow.getCell(1).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  noteRow.height = 30;
}

// ═══════════════════════════════════════════════════════════════════════════
//  케이스 표 — 공통 컬럼 매핑 및 헬퍼
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 컬럼 매핑 (A 는 좌측 margin) — 총 11 컬럼 (A..K)
 *
 *   A: margin
 *   B: No
 *   C: 구분 / CASE 명
 *   D: Checklist 명 / 테스트 내용
 *   E: 예상 결과 (Checklist 는 D 와 merge 해서 비움)
 *   F: Check 일자 / 테스트 일자      ← 회차 상세 시트 전용
 *   G: Check 결과 / 테스트 결과      ← 회차 상세 시트 전용
 *   H: 결함내역                      ← 회차 상세 시트 전용
 *   I: 조치일자                      ← 회차 상세 시트 전용
 *   J: 조치결과                      ← 회차 상세 시트 전용
 *   K: 여분(시각 정리용)
 *
 * 시트별 사용 범위:
 *   - "테스트케이스"(조망) : A..E + 회차 수만큼 판정 컬럼이 F 부터 이어짐.
 *                            F..J 의 결과·결함·조치 의미는 쓰지 않는다.
 *   - "N차 결과"(상세)     : A..J 전부
 *   - 명세서의 "테스트케이스" : A..E (회차가 0개라 판정 컬럼도 없음)
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

/**
 * 상단 박스 — 프로그램ID / 테스트 업무명 / 문서명. 모든 케이스 시트가 공유한다.
 * 라벨(B-C) + 값(D-rightCol) 2분할. rightCol 이 좁은 시트에서도 머지가 깨지지 않는다.
 */
function writeTopBox(
  ws: ExcelJS.Worksheet,
  input: TestSpecXlsxInput,
  rightCol: number,
  extraRows: [string, string][] = [],
): void {
  ws.addRow([]); // margin

  const boxRows: [string, string][] = [
    ["프로그램 ID",  input.programIds || "-"],
    ["테스트 업무명", input.subtitle   || "-"],
    [`테스트 ${input.docKind === "spec" ? "명세서명" : "결과서명"}`,
                    `${input.displayId} · ${input.testTaskNm}`],
    ...extraRows,
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
}

/** 섹션 제목 띠 (공통 Checklist / 기능 테스트케이스) */
function writeSectionTitle(ws: ExcelJS.Worksheet, title: string, rightCol: number): void {
  const row = ws.addRow([]);
  row.getCell(COL.no).value = title;
  ws.mergeCells(row.number, COL.no, row.number, rightCol);
  const cell = row.getCell(COL.no);
  cell.font = { bold: true, size: 12, color: { argb: HEADER_FONT_COLOR } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL_COLOR } };
  cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  row.height = 22;
}

/** "항목이 없습니다" 안내 행 */
function writeEmptyRow(ws: ExcelJS.Worksheet, message: string, rightCol: number): void {
  const r = ws.addRow([]);
  r.getCell(COL.no).value = "-";
  r.getCell(COL.desc).value = message;
  ws.mergeCells(r.number, COL.desc, r.number, rightCol);
  r.alignment = { vertical: "middle", horizontal: "center" };
  applyDataBorder(r, COL.no, rightCol);
}

/** 데이터 행 정렬 — 지정 컬럼만 가운데/좌측. rightCol 을 넘는 컬럼은 건너뛴다. */
function alignDataRow(
  r: ExcelJS.Row, rightCol: number, centerCols: number[], leftCols: number[],
): void {
  r.alignment = { vertical: "middle", wrapText: true };
  for (const c of centerCols) {
    if (c <= rightCol) r.getCell(c).alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  }
  for (const c of leftCols) {
    if (c <= rightCol) r.getCell(c).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  }
  applyDataBorder(r, COL.no, rightCol);
}

// ───────────────────────────────────────────────────────────────────────────
//  Sheet 3 — 테스트케이스 (전체 조망)
//
//  명세서: No / 구분 / 내용 / 예상결과
//  결과서: 위 + 회차 수만큼 판정 컬럼("1차","2차"...) 을 오른쪽에 붙임.
//          결함·조치 같은 상세는 여기 넣지 않는다 — 회차가 늘어날 때 표가
//          망가지지 않도록, 상세는 회차별 시트가 맡는다.
// ───────────────────────────────────────────────────────────────────────────

function buildCasesSheet(wb: ExcelJS.Workbook, input: TestSpecXlsxInput): void {
  // views.state 를 "frozen" 으로 두면서 ySplit/xSplit 이 둘 다 0 이면
  // Excel 이 잘못된 pane XML 로 인식해 "보기 부분 복구" 다이얼로그가 뜸.
  // 고정 불필요하므로 단순히 grid line 만 끄는 형태로 통일.
  const ws = wb.addWorksheet("테스트케이스", {
    views: [{ showGridLines: false }],
  });

  // 회차 판정 컬럼은 예상결과(COL.exp) 바로 다음부터 회차 수만큼 이어진다.
  const rounds       = input.rounds;
  const firstRoundCol = COL.exp + 1;
  const rightCol      = COL.exp + rounds.length;

  // 컬럼 폭 — 조망 시트는 본문을 넓게, 판정 컬럼은 좁게
  ws.getColumn(COL.margin).width =  2;
  ws.getColumn(COL.no    ).width =  8;
  ws.getColumn(COL.group ).width = 14;
  ws.getColumn(COL.desc  ).width = 50;
  ws.getColumn(COL.exp   ).width = 38;
  for (let i = 0; i < rounds.length; i++) {
    // "3차(최신)" 라벨이 잘리지 않을 만큼만
    ws.getColumn(firstRoundCol + i).width = 12;
  }
  ws.getColumn(rightCol + 1).width = 2;  // 우측 여백

  writeTopBox(ws, input, rightCol);

  // ── 공통 Checklist 섹션 ──────────────────────────────────────────────
  writeSectionTitle(ws, "공통 Checklist", rightCol);

  const chkHeader = ws.addRow([]);
  chkHeader.getCell(COL.no   ).value = "No";
  chkHeader.getCell(COL.group).value = "구분";
  chkHeader.getCell(COL.desc ).value = "Checklist 명";
  rounds.forEach((rd, i) => {
    chkHeader.getCell(firstRoundCol + i).value = roundLabel(rd.roundNo, i === rounds.length - 1);
  });
  // Checklist 는 예상결과 컬럼을 쓰지 않으므로 내용과 합쳐 넓게
  ws.mergeCells(chkHeader.number, COL.desc, chkHeader.number, COL.exp);
  applyHeaderRow(chkHeader, COL.no, rightCol);

  if (input.checklist.length === 0) {
    writeEmptyRow(ws, "(공통 Checklist 항목이 없습니다.)", rightCol);
  } else {
    for (const c of input.checklist) {
      const r = ws.addRow([]);
      r.getCell(COL.no   ).value = c.no;
      r.getCell(COL.group).value = c.group ?? "";
      r.getCell(COL.desc ).value = c.scenario;
      rounds.forEach((_, i) => {
        r.getCell(firstRoundCol + i).value = c.roundVerdicts?.[i] ?? "";
      });
      ws.mergeCells(r.number, COL.desc, r.number, COL.exp);
      alignDataRow(
        r, rightCol,
        [COL.no, COL.group, ...rounds.map((_, i) => firstRoundCol + i)],
        [COL.desc],
      );
    }
  }

  ws.addRow([]); // 섹션 사이 여백

  // ── 기능 테스트케이스 섹션 ──────────────────────────────────────────
  writeSectionTitle(ws, "기능 테스트케이스", rightCol);

  const fnHeader = ws.addRow([]);
  fnHeader.getCell(COL.no   ).value = "No";
  fnHeader.getCell(COL.group).value = "CASE 명";
  fnHeader.getCell(COL.desc ).value = "테스트 내용";
  fnHeader.getCell(COL.exp  ).value = "예상 결과";
  rounds.forEach((rd, i) => {
    fnHeader.getCell(firstRoundCol + i).value = roundLabel(rd.roundNo, i === rounds.length - 1);
  });
  applyHeaderRow(fnHeader, COL.no, rightCol);

  if (input.functional.length === 0) {
    writeEmptyRow(ws, "(기능 테스트케이스가 없습니다.)", rightCol);
  } else {
    for (const c of input.functional) {
      const r = ws.addRow([]);
      r.getCell(COL.no   ).value = c.no;
      r.getCell(COL.group).value = c.group ?? "";
      r.getCell(COL.desc ).value = c.scenario;
      r.getCell(COL.exp  ).value = c.expected;
      rounds.forEach((_, i) => {
        r.getCell(firstRoundCol + i).value = c.roundVerdicts?.[i] ?? "";
      });
      alignDataRow(
        r, rightCol,
        [COL.no, ...rounds.map((_, i) => firstRoundCol + i)],
        [COL.group, COL.desc, COL.exp],
      );
    }
  }

  // 회차가 있을 때만 범례 — 빈 칸의 의미를 설명해야 오해가 없다
  if (rounds.length > 0) {
    ws.addRow([]);
    const legend = ws.addRow([]);
    legend.getCell(COL.no).value =
      "※ 회차 칸이 비어 있으면 그 회차를 시작한 뒤에 추가된 케이스입니다. 회차별 결함·조치 내용은 각 회차 시트를 보세요.";
    ws.mergeCells(legend.number, COL.no, legend.number, rightCol);
    legend.getCell(COL.no).font = { italic: true, size: 10, color: { argb: "FF808080" } };
    legend.getCell(COL.no).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    legend.height = 28;
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Sheet 4..N — 회차별 결과 상세 (결과서 전용)
// ───────────────────────────────────────────────────────────────────────────

function buildRoundSheet(
  wb: ExcelJS.Workbook, input: TestSpecXlsxInput, round: TestSpecXlsxRound,
): void {
  const ws = wb.addWorksheet(`${round.roundNo}차 결과`, {
    views: [{ showGridLines: false }],
  });

  const rightCol = COL.fixRs;   // 결과·결함·조치까지 전 컬럼 사용

  ws.getColumn(COL.margin).width =  2;
  ws.getColumn(COL.no    ).width =  8;
  ws.getColumn(COL.group ).width = 14;
  ws.getColumn(COL.desc  ).width = 38;
  ws.getColumn(COL.exp   ).width = 28;
  ws.getColumn(COL.date  ).width = 14;
  ws.getColumn(COL.result).width = 13;
  ws.getColumn(COL.defect).width = 28;
  ws.getColumn(COL.fixDt ).width = 13;
  ws.getColumn(COL.fixRs ).width = 24;
  ws.getColumn(COL.tail  ).width =  2;

  // 상단 박스에 회차 메타를 덧붙인다 — 시트를 따로 떼어 봐도 어느 회차인지 알 수 있도록.
  const roundCaseCount = round.checklist.length + round.functional.length;
  const specCaseCount  = input.checklist.length + input.functional.length;
  // 진행중 회차는 종료일이 없다. 시작일만 찍으면 "하루짜리 회차" 로 읽히므로
  // 끝이 열려 있음을 명시한다.
  const period = round.bgngDate
    ? `${round.bgngDate} ~ ${round.endDate || "(진행중)"}`
    : (round.endDate || "-");
  const summaryText = Object.entries(round.summary)
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${label} ${n}`)
    .join(" / ") || "-";

  writeTopBox(ws, input, rightCol, [
    ["회차", `${roundLabel(round.roundNo, round === input.rounds[input.rounds.length - 1])} · ${round.statusLabel}`],
    ["환경 / 빌드", `${round.envirLabel}${round.bldVrsnNm ? ` / ${round.bldVrsnNm}` : ""}`],
    ["기간", period],
    // 이 회차 대상 건수가 명세 전체와 다를 수 있다(회차 시작 후 케이스 추가).
    // 건수 차이를 표 밖에서 먼저 설명해야 "누락" 으로 오해하지 않는다.
    ["대상 건수", roundCaseCount === specCaseCount
      ? `${roundCaseCount}건`
      : `${roundCaseCount}건 (명세 전체 ${specCaseCount}건 — 이 회차 시작 후 추가된 케이스는 제외)`],
    ["판정 집계", summaryText],
  ]);

  // ── 공통 Checklist 섹션 ──────────────────────────────────────────────
  writeSectionTitle(ws, "공통 Checklist", rightCol);

  const chkHeader = ws.addRow([]);
  chkHeader.getCell(COL.no    ).value = "No";
  chkHeader.getCell(COL.group ).value = "구분";
  chkHeader.getCell(COL.desc  ).value = "Checklist 명";
  chkHeader.getCell(COL.date  ).value = "Check 일자";
  chkHeader.getCell(COL.result).value = "Check 결과";
  chkHeader.getCell(COL.defect).value = "결함내역";
  chkHeader.getCell(COL.fixDt ).value = "조치일자";
  chkHeader.getCell(COL.fixRs ).value = "조치결과";
  // Checklist 는 예상결과 컬럼을 쓰지 않으므로 내용과 합쳐 넓게
  ws.mergeCells(chkHeader.number, COL.desc, chkHeader.number, COL.exp);
  applyHeaderRow(chkHeader, COL.no, rightCol);

  if (round.checklist.length === 0) {
    writeEmptyRow(ws, "(이 회차의 공통 Checklist 결과가 없습니다.)", rightCol);
  } else {
    for (const c of round.checklist) {
      const r = ws.addRow([]);
      r.getCell(COL.no    ).value = c.no;
      r.getCell(COL.group ).value = c.group ?? "";
      r.getCell(COL.desc  ).value = c.scenario;
      r.getCell(COL.date  ).value = c.testedDate;
      r.getCell(COL.result).value = c.resultLabel;
      r.getCell(COL.defect).value = c.defectText;
      r.getCell(COL.fixDt ).value = c.fixDate;
      r.getCell(COL.fixRs ).value = c.fixResult;
      ws.mergeCells(r.number, COL.desc, r.number, COL.exp);
      alignDataRow(
        r, rightCol,
        [COL.no, COL.group, COL.date, COL.result, COL.fixDt],
        [COL.desc, COL.defect, COL.fixRs],
      );
    }
  }

  ws.addRow([]); // 섹션 사이 여백

  // ── 기능 테스트케이스 섹션 ──────────────────────────────────────────
  writeSectionTitle(ws, "기능 테스트케이스", rightCol);

  const fnHeader = ws.addRow([]);
  fnHeader.getCell(COL.no    ).value = "No";
  fnHeader.getCell(COL.group ).value = "CASE 명";
  fnHeader.getCell(COL.desc  ).value = "테스트 내용";
  fnHeader.getCell(COL.exp   ).value = "예상 결과";
  fnHeader.getCell(COL.date  ).value = "테스트 일자";
  fnHeader.getCell(COL.result).value = "테스트 결과";
  fnHeader.getCell(COL.defect).value = "결함내역";
  fnHeader.getCell(COL.fixDt ).value = "조치일자";
  fnHeader.getCell(COL.fixRs ).value = "조치결과";
  applyHeaderRow(fnHeader, COL.no, rightCol);

  if (round.functional.length === 0) {
    writeEmptyRow(ws, "(이 회차의 기능 테스트케이스 결과가 없습니다.)", rightCol);
  } else {
    for (const c of round.functional) {
      const r = ws.addRow([]);
      r.getCell(COL.no    ).value = c.no;
      r.getCell(COL.group ).value = c.group ?? "";
      r.getCell(COL.desc  ).value = c.scenario;
      r.getCell(COL.exp   ).value = c.expected;
      r.getCell(COL.date  ).value = c.testedDate;
      r.getCell(COL.result).value = c.resultLabel;
      r.getCell(COL.defect).value = c.defectText;
      r.getCell(COL.fixDt ).value = c.fixDate;
      r.getCell(COL.fixRs ).value = c.fixResult;
      alignDataRow(
        r, rightCol,
        [COL.no, COL.date, COL.result, COL.fixDt],
        [COL.group, COL.desc, COL.exp, COL.defect, COL.fixRs],
      );
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
  buildHistorySheet(wb, input);
  buildCasesSheet(wb, input);
  // 회차 상세 — 회차마다 1시트. 명세서(rounds 빈 배열)에서는 아무것도 안 나온다.
  for (const round of input.rounds) {
    buildRoundSheet(wb, input, round);
  }
  // 증적 시트는 결과서일 때만 의미 있음 (명세 시점에는 증적이 없음)
  if (input.docKind === "result") buildEvidenceSheet(wb);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
