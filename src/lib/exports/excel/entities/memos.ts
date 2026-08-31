/**
 * 엑셀 다운로드 — 메모 목록
 */

import type { ExcelColumn, ExportConfig } from "../types";
import {
  fetchProjectMemos,
  type MemoListItem,
} from "@/lib/exports/memos-data";

const REF_TYPE_LABEL: Record<string, string> = {
  REQUIREMENT: "요구사항",
  TASK:        "과업",
  FUNCTION:    "기능",
  AREA:        "영역",
  SCREEN:      "화면",
  UNIT_WORK:   "단위업무",
};

const VISIBILITY_LABEL: Record<string, string> = {
  PRIVATE:   "나만보기",
  TEAM_READ: "전체조회",
  TEAM_EDIT: "전체수정",
};

const MEMO_TYPE_LABEL: Record<string, string> = {
  WEB:   "웹 에디터",
  EXCEL: "엑셀형",
};

const PURPOSE_LABEL: Record<string, string> = {
  GENERAL: "메모",
  MEETING: "회의록",
};

const columns: ExcelColumn<MemoListItem>[] = [
  { key: "subject",       header: "제목",        width: 40 },
  { key: "creatMberName", header: "작성자",      width: 16 },
  { key: "purposeCode",   header: "구분",        width: 10,
    format: (r) => PURPOSE_LABEL[r.purposeCode] ?? r.purposeCode },
  { key: "memoTyCode",    header: "작성 방식",   width: 12,
    format: (r) => MEMO_TYPE_LABEL[r.memoTyCode] ?? r.memoTyCode },
  { key: "visbltyCode",   header: "공개 범위",   width: 12,
    format: (r) => VISIBILITY_LABEL[r.visbltyCode] ?? r.visbltyCode },
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
    const url        = new URL(req.url);
    const refType    = url.searchParams.get("refType")        ?? undefined;
    const refId      = url.searchParams.get("refId")          ?? undefined;
    const search     = url.searchParams.get("search")?.trim() ?? undefined;
    const visibility = url.searchParams.get("visibility")     ?? undefined;
    const purpose    = url.searchParams.get("purpose")        ?? undefined;
    return fetchProjectMemos({
      projectId: params.id, mberId, refType, refId, search, visibility, purpose,
    });
  },
};
