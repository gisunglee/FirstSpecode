/**
 * 엑셀 다운로드 — 요구사항 목록 (UW-00015)
 *
 * 데이터 정합성:
 *   fetchProjectRequirements 를 화면 GET 라우트와 공유. 화면 행 = 엑셀 행.
 */

import type { ExcelColumn, ExportConfig } from "../types";
import {
  fetchProjectRequirements,
  type RequirementListItem,
} from "@/lib/exports/requirements-data";

// 화면(page.tsx) 의 PRIORITY_LABELS / SOURCE_LABELS 와 동일 매핑
const PRIORITY_LABEL: Record<string, string> = {
  HIGH:   "높음",
  MEDIUM: "중간",
  LOW:    "낮음",
};
const SOURCE_LABEL: Record<string, string> = {
  RFP:    "RFP",
  ADD:    "추가",
  CHANGE: "변경",
};

const columns: ExcelColumn<RequirementListItem>[] = [
  { key: "displayId",     header: "요구사항 ID", width: 14 },
  { key: "name",          header: "요구사항명",   width: 40 },
  { key: "taskName",      header: "과업",        width: 24 },
  { key: "priority",      header: "우선순위",     width: 10,
    format: (r) => PRIORITY_LABEL[r.priority] ?? r.priority },
  { key: "source",        header: "출처",        width: 8,
    format: (r) => SOURCE_LABEL[r.source] ?? r.source },
  { key: "assignee",      header: "담당자",      width: 18,
    format: (r) => r.assignMemberName ?? "" },
  { key: "unitWorkCount", header: "단위업무 수",  width: 12 },
];

export const requirementsExportConfig: ExportConfig<RequirementListItem, { id: string }> = {
  permission:   "content.export",
  resolveScope: (p) => ({ projectId: p.id }),
  sheetName:    "요구사항 목록",
  entityKey:    "requirements",
  columns,
  fetchData: async ({ req, params, mberId }) => {
    const url        = new URL(req.url);
    const assignedTo = url.searchParams.get("assignedTo") ?? undefined;
    // "me" → 인증 mberId 변환 (화면-엑셀 결과 일치)
    const assigneeFilter = assignedTo === "me" ? mberId : (assignedTo || undefined);
    return fetchProjectRequirements({ projectId: params.id, assigneeFilter });
  },
};
