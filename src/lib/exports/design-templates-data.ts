/**
 * exports/design-templates-data.ts — 설계 양식 목록 데이터 조립 (서버 공용)
 *
 * 화면 GET 라우트와 export 라우트가 공유. 화면 = 엑셀 결과 일치.
 */

import { prisma } from "@/lib/prisma";

export type DesignTemplateListItem = {
  dsgnTmplId:  string;
  projectId:   string | null;
  isSystem:    boolean;
  refTyCode:   string;
  tmplNm:      string;
  tmplDc:      string;
  hasExample:  boolean;
  hasTemplate: boolean;
  useYn:       string;
  defaultYn:   string;
  sortOrdr:    number;
  creatMberId: string | null;
  creatDt:     string;
  mdfcnDt:     string;
};

/**
 * fetchProjectDesignTemplates — 프로젝트 양식 + 시스템 공통 양식 통합 목록.
 *
 *   - scope: "all"(기본) | "system" | "project"
 *   - 본문은 응답에서 제외, 존재 여부만 플래그로 반환 (목록 페이로드 보호)
 */
export async function fetchProjectDesignTemplates(opts: {
  projectId:    string;
  refTyCode?:   string | null;
  useYnFilter?: string | null;
  scope?:       string;
}): Promise<DesignTemplateListItem[]> {
  const { projectId, refTyCode, useYnFilter, scope = "all" } = opts;

  const templates = await prisma.tbAiDesignTemplate.findMany({
    where: {
      ...(scope === "system"
        ? { prjct_id: null }
        : scope === "project"
          ? { prjct_id: projectId }
          : { OR: [{ prjct_id: projectId }, { prjct_id: null }] }),
      ...(refTyCode   ? { ref_ty_code: refTyCode }   : {}),
      ...(useYnFilter ? { use_yn:      useYnFilter } : {}),
    },
    orderBy: [
      { sort_ordr: "asc" },
      { creat_dt:  "asc" },
    ],
  });

  return templates.map((t) => ({
    dsgnTmplId:  t.dsgn_tmpl_id,
    projectId:   t.prjct_id ?? null,
    isSystem:    t.prjct_id === null,
    refTyCode:   t.ref_ty_code,
    tmplNm:      t.tmpl_nm,
    tmplDc:      t.tmpl_dc ?? "",
    hasExample:  !!(t.example_cn  && t.example_cn.trim().length > 0),
    hasTemplate: !!(t.template_cn && t.template_cn.trim().length > 0),
    useYn:       t.use_yn,
    defaultYn:   t.default_yn,
    sortOrdr:    t.sort_ordr,
    creatMberId: t.creat_mber_id ?? null,
    creatDt:     t.creat_dt.toISOString(),
    mdfcnDt:     t.mdfcn_dt.toISOString(),
  }));
}
