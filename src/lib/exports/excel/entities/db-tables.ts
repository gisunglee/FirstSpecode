/**
 * 엑셀 다운로드 — DB 테이블 목록
 */

import type { ExcelColumn, ExportConfig } from "../types";
import {
  fetchProjectDbTables,
  type DbTableListItem,
} from "@/lib/exports/db-tables-data";

const IO_PROFILE_LABEL: Record<string, string> = {
  READ_HEAVY:  "조회 위주",
  WRITE_HEAVY: "쓰기 위주",
  MIXED:       "혼합",
  NONE:        "사용 없음",
};

const columns: ExcelColumn<DbTableListItem>[] = [
  { key: "tblPhysclNm",  header: "물리 테이블명", width: 28 },
  { key: "tblLgclNm",    header: "논리 테이블명", width: 28 },
  { key: "tblDc",        header: "설명",         width: 40 },
  { key: "assignee",     header: "담당자",       width: 16,
    format: (r) => r.assignMemberName ?? "" },
  { key: "columnCount",  header: "컬럼 수",      width: 10 },
  { key: "functionCount", header: "사용 기능 수", width: 12 },
  { key: "usedColCount", header: "사용 컬럼 수", width: 12 },
  { key: "ioProfile",    header: "I/O 프로파일", width: 14,
    format: (r) => IO_PROFILE_LABEL[r.ioProfile] ?? r.ioProfile },
  { key: "lastUsedDt",   header: "최근 사용일",   width: 18,
    format: (r) => r.lastUsedDt ?? "" },
  { key: "creatDt",      header: "생성일시",     width: 20 },
  { key: "mdfcnDt",      header: "수정일시",     width: 20,
    format: (r) => r.mdfcnDt ?? "" },
];

export const dbTablesExportConfig: ExportConfig<DbTableListItem, { id: string }> = {
  permission:   "content.export",
  resolveScope: (p) => ({ projectId: p.id }),
  sheetName:    "DB 테이블 목록",
  entityKey:    "db-tables",
  columns,
  fetchData: async ({ req, params, mberId }) => {
    const url        = new URL(req.url);
    const assignedTo = url.searchParams.get("assignedTo") ?? undefined;
    const assigneeFilter = assignedTo === "me" ? mberId : (assignedTo || undefined);
    return fetchProjectDbTables({ projectId: params.id, assigneeFilter });
  },
};
