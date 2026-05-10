/**
 * 엑셀 다운로드 — 환경설정
 *
 * 화면은 그룹별 카드로 보지만, 엑셀은 행 단위(그룹 컬럼 추가)로 평탄화.
 * 같은 데이터를 형식만 바꿔서 내보냄.
 */

import type { ExcelColumn, ExportConfig } from "../types";
import {
  fetchProjectConfigsFlat,
  type ConfigFlatRow,
} from "@/lib/exports/configs-data";

const VALUE_TYPE_LABEL: Record<string, string> = {
  STRING:  "문자열",
  NUMBER:  "숫자",
  BOOLEAN: "Y/N",
  SELECT:  "선택",
  JSON:    "JSON",
};

const columns: ExcelColumn<ConfigFlatRow>[] = [
  { key: "group",        header: "그룹",       width: 20 },
  { key: "label",        header: "라벨",       width: 28 },
  { key: "key",          header: "키",         width: 28 },
  { key: "value",        header: "값",         width: 24 },
  { key: "valueType",    header: "타입",       width: 10,
    format: (r) => VALUE_TYPE_LABEL[r.valueType] ?? r.valueType },
  { key: "defaultValue", header: "기본값",     width: 16,
    format: (r) => r.defaultValue ?? "" },
  { key: "description",  header: "설명",       width: 40,
    format: (r) => r.description ?? "" },
  { key: "sortOrder",    header: "정렬",       width: 8 },
];

export const configsExportConfig: ExportConfig<ConfigFlatRow, { id: string }> = {
  permission:   "content.export",
  resolveScope: (p) => ({ projectId: p.id }),
  sheetName:    "환경설정",
  entityKey:    "configs",
  columns,
  fetchData: async ({ params }) => {
    return fetchProjectConfigsFlat({ projectId: params.id });
  },
};
