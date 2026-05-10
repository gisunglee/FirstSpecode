/**
 * 엑셀 다운로드 — 프롬프트 템플릿 목록
 */

import type { ExcelColumn, ExportConfig } from "../types";
import {
  fetchProjectPromptTemplates,
  type PromptTemplateListItem,
} from "@/lib/exports/prompt-templates-data";

const TASK_TYPE_LABEL: Record<string, string> = {
  INSPECT:                   "명세 검토",
  DESIGN:                    "설계",
  IMPLEMENT:                 "구현",
  MOCKUP:                    "목업",
  IMPACT:                    "영향도 분석",
  CUSTOM:                    "자유 요청",
  PLAN_STUDIO_ARTF_GENERATE: "기획실 산출물 생성",
};

const REF_TYPE_LABEL: Record<string, string> = {
  UNIT_WORK:        "단위업무",
  SCREEN:           "화면",
  AREA:             "영역",
  FUNCTION:         "기능",
  PLAN_STUDIO_ARTF: "기획실",
};

const columns: ExcelColumn<PromptTemplateListItem>[] = [
  { key: "tmplNm",     header: "템플릿 명",       width: 32 },
  { key: "taskTyCode", header: "작업 유형",       width: 16,
    format: (r) => TASK_TYPE_LABEL[r.taskTyCode] ?? r.taskTyCode },
  { key: "refTyCode",  header: "사용처",          width: 14,
    format: (r) => (r.refTyCode ? (REF_TYPE_LABEL[r.refTyCode] ?? r.refTyCode) : "") },
  { key: "scope",      header: "구분",           width: 12,
    format: (r) => (r.isSystem ? "시스템 공통" : "프로젝트") },
  { key: "divCode",    header: "산출물 구분",     width: 14,
    format: (r) => r.divCode ?? "" },
  { key: "fmtCode",    header: "출력 형식",       width: 12,
    format: (r) => r.fmtCode ?? "" },
  { key: "tmplDc",     header: "설명",           width: 36 },
  { key: "sysPromptPreview", header: "프롬프트 미리보기", width: 50 },
  { key: "useYn",      header: "사용",           width: 8 },
  { key: "defaultYn",  header: "기본",           width: 8 },
  { key: "useCnt",     header: "사용 횟수",       width: 10 },
  { key: "sortOrdr",   header: "정렬",           width: 8 },
  { key: "creatDt",    header: "생성일시",       width: 20 },
  { key: "mdfcnDt",    header: "수정일시",       width: 20 },
];

export const promptTemplatesExportConfig: ExportConfig<PromptTemplateListItem, { id: string }> = {
  permission:   "content.export",
  resolveScope: (p) => ({ projectId: p.id }),
  sheetName:    "프롬프트 템플릿",
  entityKey:    "prompt-templates",
  columns,
  fetchData: async ({ req, params }) => {
    const url            = new URL(req.url);
    const taskTyCode     = url.searchParams.get("taskType") ?? null;
    const refTyCode      = url.searchParams.get("refType")  ?? null;
    const useYnFilter    = url.searchParams.get("useYn")    ?? null;
    const domainParam    = url.searchParams.get("domain");
    const divCodeFilter  = url.searchParams.get("divCode")  ?? null;
    const fmtCodeFilter  = url.searchParams.get("fmtCode")  ?? null;
    return fetchProjectPromptTemplates({
      projectId: params.id, taskTyCode, refTyCode, useYnFilter,
      domainParam, divCodeFilter, fmtCodeFilter,
    });
  },
};
