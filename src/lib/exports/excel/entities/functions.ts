/**
 * 엑셀 다운로드 — 기능 목록 (UW-00022)
 */

import type { ExcelColumn, ExportConfig } from "../types";
import {
  fetchProjectFunctions,
  type FunctionListItem,
} from "@/lib/exports/functions-data";

const PRIORITY_LABEL: Record<string, string> = {
  HIGH:   "높음",
  MEDIUM: "중간",
  LOW:    "낮음",
};
const COMPLEXITY_LABEL: Record<string, string> = {
  HIGH:   "높음",
  MEDIUM: "중간",
  LOW:    "낮음",
};

const columns: ExcelColumn<FunctionListItem>[] = [
  { key: "displayId",       header: "기능 ID",      width: 14 },
  { key: "name",            header: "기능명",        width: 32 },
  { key: "type",            header: "유형",         width: 12 },
  { key: "priority",        header: "우선순위",      width: 10,
    format: (r) => PRIORITY_LABEL[r.priority] ?? r.priority },
  { key: "complexity",      header: "복잡도",       width: 10,
    format: (r) => COMPLEXITY_LABEL[r.complexity] ?? r.complexity },
  { key: "effort",          header: "공수",         width: 10 },
  { key: "areaDisplayId",   header: "영역 ID",      width: 14,
    format: (r) => r.areaDisplayId ?? "" },
  { key: "areaName",        header: "영역명",       width: 22 },
  { key: "screenDisplayId", header: "화면 ID",     width: 14,
    format: (r) => r.screenDisplayId ?? "" },
  { key: "screenName",      header: "화면명",       width: 22 },
  { key: "unitWorkName",    header: "단위업무",     width: 22 },
  { key: "designRt",        header: "설계(%)",     width: 10 },
  { key: "implRt",          header: "구현(%)",     width: 10 },
  { key: "testRt",          header: "테스트(%)",   width: 10 },
];

export const functionsExportConfig: ExportConfig<FunctionListItem, { id: string }> = {
  permission:   "content.export",
  resolveScope: (p) => ({ projectId: p.id }),
  sheetName:    "기능 목록",
  entityKey:    "functions",
  columns,
  fetchData: async ({ req, params }) => {
    const url    = new URL(req.url);
    const areaId = url.searchParams.get("areaId") ?? undefined;
    return fetchProjectFunctions({ projectId: params.id, areaId });
  },
};
