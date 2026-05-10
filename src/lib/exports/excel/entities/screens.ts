/**
 * 엑셀 다운로드 — 화면 목록 (UW-00020)
 */

import type { ExcelColumn, ExportConfig } from "../types";
import {
  fetchProjectScreens,
  type ScreenListItem,
} from "@/lib/exports/screens-data";

const SCREEN_TYPE_LABEL: Record<string, string> = {
  LIST:    "목록",
  DETAIL:  "상세",
  FORM:    "입력",
  POPUP:   "팝업",
  REPORT:  "보고서",
};

const columns: ExcelColumn<ScreenListItem>[] = [
  { key: "displayId",       header: "화면 ID",     width: 14 },
  { key: "name",            header: "화면명",       width: 32 },
  { key: "type",            header: "유형",        width: 10,
    format: (r) => SCREEN_TYPE_LABEL[r.type] ?? r.type },
  { key: "categoryL",       header: "대분류",      width: 14 },
  { key: "categoryM",       header: "중분류",      width: 14 },
  { key: "categoryS",       header: "소분류",      width: 14 },
  { key: "unitWorkName",    header: "단위업무",     width: 24 },
  { key: "requirementName", header: "요구사항",     width: 24 },
  { key: "assignee",        header: "담당자",      width: 16,
    format: (r) => r.assignMemberName ?? "" },
  { key: "areaCount",       header: "영역 수",     width: 10 },
  { key: "avgDesignRt",     header: "설계(%)",     width: 10 },
  { key: "avgImplRt",       header: "구현(%)",     width: 10 },
  { key: "avgTestRt",       header: "테스트(%)",   width: 10 },
];

export const screensExportConfig: ExportConfig<ScreenListItem, { id: string }> = {
  permission:   "content.export",
  resolveScope: (p) => ({ projectId: p.id }),
  sheetName:    "화면 목록",
  entityKey:    "screens",
  columns,
  fetchData: async ({ req, params, mberId }) => {
    const url        = new URL(req.url);
    const unitWorkId = url.searchParams.get("unitWorkId") ?? undefined;
    const assignedTo = url.searchParams.get("assignedTo") ?? undefined;
    const assigneeFilter = assignedTo === "me" ? mberId : (assignedTo || undefined);
    return fetchProjectScreens({ projectId: params.id, unitWorkId, assigneeFilter });
  },
};
