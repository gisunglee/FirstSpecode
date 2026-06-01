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

// ISO 8601 문자열 → 'YYYY-MM-DD HH:MM' (로컬 시각).
// 데이터 원본은 .toISOString() 결과(UTC) — 그대로 출력하면 "2026-04-18T10:23:24.795Z" 처럼 보임.
// 엑셀에서는 사람이 읽기 쉬운 형태로만 표시. 정렬·필터 영향 없음(문자열 정렬 시에도 같은 순서 유지).
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

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
    format: (r) => formatDateTime(r.lastUsedDt) },
  { key: "creatDt",      header: "생성일시",     width: 18,
    format: (r) => formatDateTime(r.creatDt) },
  { key: "mdfcnDt",      header: "수정일시",     width: 18,
    format: (r) => formatDateTime(r.mdfcnDt) },
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
