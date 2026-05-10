/**
 * 엑셀 다운로드 — 메모 목록
 */

import type { ExcelColumn, ExportConfig } from "../types";
import {
  fetchProjectMemos,
  type MemoListItem,
} from "@/lib/exports/memos-data";

const REF_TYPE_LABEL: Record<string, string> = {
  FUNCTION:  "기능",
  AREA:      "영역",
  SCREEN:    "화면",
  UNIT_WORK: "단위업무",
};

const columns: ExcelColumn<MemoListItem>[] = [
  { key: "subject",       header: "제목",        width: 40 },
  { key: "creatMberName", header: "작성자",      width: 16 },
  { key: "shareYn",       header: "공유 여부",   width: 10,
    format: (r) => (r.shareYn === "Y" ? "공유" : "비공유") },
  { key: "refTyCode",     header: "연결 유형",   width: 12,
    format: (r) => (r.refTyCode ? (REF_TYPE_LABEL[r.refTyCode] ?? r.refTyCode) : "") },
  { key: "refName",       header: "연결 대상",   width: 30 },
  { key: "viewCnt",       header: "조회수",      width: 10 },
  { key: "creatDt",       header: "작성일시",    width: 20,
    format: (r) => r.creatDt },
];

export const memosExportConfig: ExportConfig<MemoListItem, { id: string }> = {
  permission:   "content.export",
  resolveScope: (p) => ({ projectId: p.id }),
  sheetName:    "메모 목록",
  entityKey:    "memos",
  columns,
  fetchData: async ({ req, params, mberId }) => {
    const url         = new URL(req.url);
    const refType     = url.searchParams.get("refType")        ?? undefined;
    const refId       = url.searchParams.get("refId")          ?? undefined;
    const search      = url.searchParams.get("search")?.trim() ?? undefined;
    const shareFilter = url.searchParams.get("share")          ?? undefined;
    return fetchProjectMemos({
      projectId: params.id, mberId, refType, refId, search, shareFilter,
    });
  },
};
