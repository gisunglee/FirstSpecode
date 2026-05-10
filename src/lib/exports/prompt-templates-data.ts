/**
 * exports/prompt-templates-data.ts — 프롬프트 템플릿 목록 데이터 조립 (서버 공용)
 */

import { prisma } from "@/lib/prisma";
import { buildPromptDomainWhere, parsePromptDomain } from "@/lib/prompt-template/domain";

export type PromptTemplateListItem = {
  tmplId:           string;
  projectId:        string | null;
  isSystem:         boolean;
  tmplNm:           string;
  taskTyCode:       string;
  refTyCode:        string | null;
  divCode:          string | null;
  fmtCode:          string | null;
  tmplDc:           string;
  sysPromptPreview: string;
  useYn:            string;
  defaultYn:        string;
  sortOrdr:         number;
  useCnt:           number;
  creatMberId:      string | null;
  creatDt:          string;
  mdfcnDt:          string;
};

const SYS_PROMPT_PREVIEW_LEN = 200;
function buildSysPromptPreview(raw: string | null): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  return trimmed.length > SYS_PROMPT_PREVIEW_LEN
    ? trimmed.slice(0, SYS_PROMPT_PREVIEW_LEN) + "…"
    : trimmed;
}

/**
 * fetchProjectPromptTemplates — 프로젝트 + 시스템 공통 프롬프트 템플릿 목록.
 *
 *   - domain: "general" | "plan-studio" | null(전체)
 *   - taskTyCode/refTyCode/useYnFilter: 단순 필터
 *   - divCode/fmtCode: domain="plan-studio" 일 때만 적용 (기획실 매트릭스)
 */
export async function fetchProjectPromptTemplates(opts: {
  projectId:       string;
  taskTyCode?:     string | null;
  refTyCode?:      string | null;
  useYnFilter?:    string | null;
  domainParam?:    string | null;
  divCodeFilter?:  string | null;
  fmtCodeFilter?:  string | null;
}): Promise<PromptTemplateListItem[]> {
  const {
    projectId, taskTyCode, refTyCode, useYnFilter,
    domainParam, divCodeFilter, fmtCodeFilter,
  } = opts;

  const domain = parsePromptDomain(domainParam ?? null);

  const templates = await prisma.tbAiPromptTemplate.findMany({
    where: {
      AND: [
        // 해당 프로젝트 + 시스템 공통(prjct_id=null) 만 노출
        { OR: [{ prjct_id: projectId }, { prjct_id: null }] },
        // 도메인 분류 (서버·클라 일치 보장 위해 lib 헬퍼 재사용)
        buildPromptDomainWhere(domain),
      ],
      ...(taskTyCode  ? { task_ty_code: taskTyCode }  : {}),
      ...(refTyCode   ? { ref_ty_code:  refTyCode }   : {}),
      ...(useYnFilter ? { use_yn:       useYnFilter } : {}),
      ...(domain === "plan-studio" && divCodeFilter ? { div_code: divCodeFilter } : {}),
      ...(domain === "plan-studio" && fmtCodeFilter ? { fmt_code: fmtCodeFilter } : {}),
    },
    orderBy: [
      { sort_ordr: "asc" },
      { creat_dt:  "asc" },
    ],
  });

  return templates.map((t) => ({
    tmplId:           t.tmpl_id,
    projectId:        t.prjct_id ?? null,
    isSystem:         t.prjct_id === null,
    tmplNm:           t.tmpl_nm,
    taskTyCode:       t.task_ty_code,
    refTyCode:        t.ref_ty_code   ?? null,
    divCode:          t.div_code      ?? null,
    fmtCode:          t.fmt_code      ?? null,
    tmplDc:           t.tmpl_dc       ?? "",
    sysPromptPreview: buildSysPromptPreview(t.sys_prompt_cn),
    useYn:            t.use_yn,
    defaultYn:        t.default_yn,
    sortOrdr:         t.sort_ordr,
    useCnt:           t.use_cnt,
    creatMberId:      t.creat_mber_id ?? null,
    creatDt:          t.creat_dt.toISOString(),
    mdfcnDt:          t.mdfcn_dt.toISOString(),
  }));
}
