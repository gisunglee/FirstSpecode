/**
 * 엑셀 다운로드 — 설계 양식 목록
 */

import type { ExcelColumn, ExportConfig } from "../types";
import {
  fetchProjectDesignTemplates,
  type DesignTemplateListItem,
} from "@/lib/exports/design-templates-data";

const REF_TYPE_LABEL: Record<string, string> = {
  UNIT_WORK: "단위업무",
  SCREEN:    "화면",
  AREA:      "영역",
  FUNCTION:  "기능",
};

const columns: ExcelColumn<DesignTemplateListItem>[] = [
  { key: "tmplNm",      header: "양식 명",      width: 32 },
  { key: "refTyCode",   header: "대상 계층",     width: 14,
    format: (r) => REF_TYPE_LABEL[r.refTyCode] ?? r.refTyCode },
  { key: "scope",       header: "구분",         width: 12,
    format: (r) => (r.isSystem ? "시스템 공통" : "프로젝트") },
  { key: "tmplDc",      header: "설명",         width: 40 },
  { key: "hasExample",  header: "예시 있음",    width: 10,
    format: (r) => (r.hasExample ? "Y" : "N") },
  { key: "hasTemplate", header: "템플릿 있음",  width: 10,
    format: (r) => (r.hasTemplate ? "Y" : "N") },
  { key: "useYn",       header: "사용",         width: 8 },
  { key: "defaultYn",   header: "기본",         width: 8 },
  { key: "sortOrdr",    header: "정렬",         width: 8 },
  { key: "creatDt",     header: "생성일시",     width: 20 },
  { key: "mdfcnDt",     header: "수정일시",     width: 20 },
];

export const designTemplatesExportConfig: ExportConfig<DesignTemplateListItem, { id: string }> = {
  permission:   "content.export",
  resolveScope: (p) => ({ projectId: p.id }),
  sheetName:    "설계 양식",
  entityKey:    "design-templates",
  columns,
  fetchData: async ({ req, params }) => {
    const url         = new URL(req.url);
    const refTyCode   = url.searchParams.get("refType") ?? null;
    const useYnFilter = url.searchParams.get("useYn")   ?? null;
    const scope       = url.searchParams.get("scope")   ?? "all";
    return fetchProjectDesignTemplates({
      projectId: params.id, refTyCode, useYnFilter, scope,
    });
  },
};
