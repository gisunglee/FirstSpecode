/**
 * 엑셀 다운로드 — 워크북 빌더 (공통 코어)
 *
 * 역할:
 *   - entity 컬럼 메타 + 행 데이터 → xlsx 바이너리(Buffer)
 *   - 헤더 굵게, 컬럼 너비, 자동 필터 같은 기본 스타일을 일률 적용
 *
 * 호출 관계:
 *   createExportRoute()  ← 이 함수를 부른다. entity 모듈이 직접 부를 일은 없음.
 */

import ExcelJS from "exceljs";
import type { ExcelColumn } from "./types";

/**
 * buildWorkbook — 단일 시트의 .xlsx 바이너리 생성
 *
 *   - 헤더 1행 굵게 + 자동 필터 활성
 *   - format(row) 가 있으면 그 값을, 없으면 row[key] 를 셀 값으로 사용
 *   - null/undefined 는 빈 셀로 둔다 (ExcelJS 기본 동작)
 *
 * 반환:
 *   Buffer — 라우트 핸들러가 그대로 Response 본문에 넣을 수 있는 형태
 */
export async function buildWorkbook<T>(opts: {
  sheetName: string;
  columns:   ExcelColumn<T>[];
  rows:      T[];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(opts.sheetName);

  // 헤더(=컬럼 정의) 등록 — width 미지정 시 16글자 기본
  ws.columns = opts.columns.map((c) => ({
    header: c.header,
    key:    c.key,
    width:  c.width ?? 16,
  }));

  // 헤더 1행 굵게
  ws.getRow(1).font = { bold: true };

  // 데이터 행 기록
  // ExcelJS 의 addRow(record) 는 ws.columns 의 key 와 매칭해 셀에 넣어 준다.
  for (const row of opts.rows) {
    const record: Record<string, unknown> = {};
    for (const col of opts.columns) {
      record[col.key] = col.format
        ? col.format(row)
        : (row as Record<string, unknown>)[col.key];
    }
    ws.addRow(record);
  }

  // 자동 필터 — 헤더 행 전체에 적용. 사용자가 엑셀에서 바로 필터 사용 가능
  if (opts.columns.length > 0) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to:   { row: 1, column: opts.columns.length },
    };
  }

  // ExcelJS 는 ArrayBuffer 를 반환 — Node Buffer 로 감싸 라우트에서 그대로 사용
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}
