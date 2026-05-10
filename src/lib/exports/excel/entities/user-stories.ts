/**
 * 엑셀 다운로드 — 사용자스토리 목록 (UW-00016)
 */

import type { ExcelColumn, ExportConfig } from "../types";
import {
  fetchProjectUserStories,
  type UserStoryListItem,
} from "@/lib/exports/user-stories-data";

const columns: ExcelColumn<UserStoryListItem>[] = [
  { key: "displayId",            header: "스토리 ID",     width: 14 },
  { key: "name",                 header: "스토리명",       width: 36 },
  { key: "requirementDisplayId", header: "요구사항 ID",   width: 14 },
  { key: "requirementName",      header: "요구사항명",     width: 30 },
  { key: "taskName",             header: "과업",          width: 20 },
  { key: "persona",              header: "페르소나",       width: 24 },
  { key: "acceptanceCriteriaCount", header: "인수기준 수", width: 12 },
];

export const userStoriesExportConfig: ExportConfig<UserStoryListItem, { id: string }> = {
  permission:   "content.export",
  resolveScope: (p) => ({ projectId: p.id }),
  sheetName:    "사용자스토리 목록",
  entityKey:    "user-stories",
  columns,
  fetchData: async ({ req, params }) => {
    const url           = new URL(req.url);
    const taskId        = url.searchParams.get("taskId")        || undefined;
    const requirementId = url.searchParams.get("requirementId") || undefined;
    const keyword       = url.searchParams.get("keyword")       || undefined;
    return fetchProjectUserStories({ projectId: params.id, taskId, requirementId, keyword });
  },
};
