/**
 * 엑셀 다운로드 — 단위업무 목록 (UW-00019)
 */

import type { ExcelColumn, ExportConfig } from "../types";
import {
  fetchProjectUnitWorks,
  type UnitWorkListItem,
} from "@/lib/exports/unit-works-data";

const columns: ExcelColumn<UnitWorkListItem>[] = [
  { key: "displayId",    header: "단위업무 ID", width: 14 },
  { key: "name",         header: "단위업무명",   width: 36 },
  { key: "reqDisplayId", header: "요구사항 ID", width: 14 },
  { key: "reqName",      header: "요구사항명",   width: 30 },
  { key: "assignee",     header: "담당자",      width: 16,
    format: (r) => r.assignMemberName ?? "" },
  { key: "startDate",    header: "시작일",      width: 12,
    format: (r) => r.startDate ?? "" },
  { key: "endDate",      header: "종료일",      width: 12,
    format: (r) => r.endDate ?? "" },
  { key: "progress",     header: "진척률(%)",   width: 10 },
  { key: "screenCount",  header: "화면 수",     width: 10 },
  { key: "analyRt",      header: "분석(%)",     width: 10 },
  { key: "designRt",     header: "설계(%)",     width: 10 },
  { key: "implRt",       header: "구현(%)",     width: 10 },
  { key: "testRt",       header: "테스트(%)",   width: 10 },
  { key: "description",  header: "설명",        width: 40 },
];

export const unitWorksExportConfig: ExportConfig<UnitWorkListItem, { id: string }> = {
  permission:   "content.export",
  resolveScope: (p) => ({ projectId: p.id }),
  sheetName:    "단위업무 목록",
  entityKey:    "unit-works",
  columns,
  fetchData: async ({ req, params, mberId }) => {
    const url        = new URL(req.url);
    const reqId      = url.searchParams.get("reqId") ?? undefined;
    const assignedTo = url.searchParams.get("assignedTo") ?? undefined;
    const assigneeFilter = assignedTo === "me" ? mberId : (assignedTo || undefined);
    return fetchProjectUnitWorks({ projectId: params.id, reqId, assigneeFilter });
  },
};
