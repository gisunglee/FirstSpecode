/**
 * 엑셀 다운로드 — 영역 목록 (UW-00021)
 */

import type { ExcelColumn, ExportConfig } from "../types";
import {
  fetchProjectAreas,
  type AreaListItem,
} from "@/lib/exports/areas-data";
import { getArtifactScope } from "@/lib/exports/artifact-scope";
import { SCOPE_STTUS_LABELS, isScopeSttusCode } from "@/lib/scopeStatus";

const AREA_TYPE_LABEL: Record<string, string> = {
  LIST:    "데이터 목록",
  DETAIL:  "상세",
  FORM:    "입력",
  SEARCH:  "검색",
  ACTION:  "액션",
  HEADER:  "헤더",
};

const columns: ExcelColumn<AreaListItem>[] = [
  { key: "displayId",       header: "영역 ID",      width: 14 },
  { key: "scopeStatus",     header: "구분",         width: 8,
    format: (r) => isScopeSttusCode(r.scopeStatus) ? SCOPE_STTUS_LABELS[r.scopeStatus] : r.scopeStatus },
  { key: "name",            header: "영역명",        width: 30 },
  { key: "type",            header: "유형",         width: 14,
    format: (r) => AREA_TYPE_LABEL[r.type] ?? r.type },
  { key: "screenDisplayId", header: "화면 ID",      width: 14,
    format: (r) => r.screenDisplayId ?? "" },
  { key: "screenName",      header: "화면명",        width: 24 },
  { key: "unitWorkName",    header: "단위업무",      width: 24,
    format: (r) => r.unitWorkName ?? "" },
  { key: "functionCount",   header: "기능 수",      width: 10 },
  { key: "totalEffortHours", header: "총 공수(h)",  width: 12 },
  { key: "avgDesignRt",     header: "설계(%)",      width: 10 },
  { key: "avgImplRt",       header: "구현(%)",      width: 10 },
];

export const areasExportConfig: ExportConfig<AreaListItem, { id: string }> = {
  permission:   "content.export",
  resolveScope: (p) => ({ projectId: p.id }),
  sheetName:    "영역 목록",
  entityKey:    "areas",
  columns,
  fetchData: async ({ req, params }) => {
    const url      = new URL(req.url);
    const screenId = url.searchParams.get("screenId") ?? undefined;
    // 산출물 출력 범위 — SCOPED 면 이전 사업분(EXISTING)은 빠진다.
    const scope = await getArtifactScope(params.id);
    return fetchProjectAreas({ projectId: params.id, scope, screenId });
  },
};
