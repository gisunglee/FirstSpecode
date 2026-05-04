/**
 * plan-studio/prompts — 기획실 산출물 생성용 시스템 프롬프트 조회
 *
 * 역할:
 *   - tb_ai_prompt_template 에서 (구분 × 형식) 매트릭스 키로 시스템 프롬프트를 조회
 *   - 매칭된 템플릿의 use_cnt 를 1 증가 (운영 통계용)
 *
 * 매칭 키:
 *   ref_ty_code  = 'PLAN_STUDIO_ARTF'
 *   task_ty_code = 'PLAN_STUDIO_ARTF_GENERATE'
 *   div_code     = IA | JOURNEY | FLOW | MOCKUP | ERD | PROCESS
 *   fmt_code     = MD | MERMAID | HTML
 *
 * 우선순위:
 *   1. 프로젝트별 템플릿(prjct_id = projectId)
 *   2. 시스템 공통(prjct_id = NULL)
 *   같은 스코프 내 default_yn='Y' 우선, 동일 시 최신 생성순
 *
 * 변경 이력:
 *   2026-05-04  파일(.claude/prompts/plan-studio/{div}-{fmt}.md) → DB 조회로 전환.
 *               단일 진실의 원천(tb_ai_prompt_template) 통합. 운영자가 화면에서 편집 가능.
 */

import { prisma } from "@/lib/prisma";

/**
 * 기획실 산출물 생성용 시스템 프롬프트를 DB 에서 조회.
 *
 * 부수효과: 매칭된 템플릿의 use_cnt 를 1 증가시킨다 (프롬프트 관리 화면의 "이용 횟수" 갱신).
 *
 * @param projectId 현재 프로젝트 ID — 프로젝트 전용 템플릿 우선 매칭
 * @param divCode   산출물 구분 (IA/JOURNEY/FLOW/MOCKUP/ERD/PROCESS)
 * @param fmtCode   출력 형식 (MD/MERMAID/HTML)
 * @returns 시스템 프롬프트 본문. 매칭 실패 시 폴백 한 줄 반환.
 */
export async function getRequestPrompt(
  projectId: string,
  divCode:   string,
  fmtCode:   string,
): Promise<string> {
  const tmpl = await prisma.tbAiPromptTemplate.findFirst({
    where: {
      // 프로젝트 전용 + 시스템 공통 둘 다 후보
      OR: [{ prjct_id: projectId }, { prjct_id: null }],
      ref_ty_code:  "PLAN_STUDIO_ARTF",
      task_ty_code: "PLAN_STUDIO_ARTF_GENERATE",
      div_code:     divCode,
      fmt_code:     fmtCode,
      use_yn:       "Y",
    },
    orderBy: [
      // default_yn='Y' 우선 (시스템 시드)
      { default_yn: "desc" },
      // 같은 default 안에서는 프로젝트 전용(NOT NULL) 우선
      { prjct_id:   { sort: "desc", nulls: "last" } },
      // 동일 조건이면 최신 생성순
      { creat_dt:   "desc" },
    ],
  });

  // 매칭 실패 — 시드가 비었거나 운영자가 use_yn='N' 처리한 경우의 안전장치
  if (!tmpl) {
    return `요구사항과 기획내용을 분석하여 ${divCode} 산출물을 ${fmtCode} 형식으로 생성하세요.`;
  }

  // 사용 통계 — 화면 "이용 횟수" 컬럼에 즉시 반영
  await prisma.tbAiPromptTemplate.update({
    where: { tmpl_id: tmpl.tmpl_id },
    data:  { use_cnt: { increment: 1 } },
  });

  return tmpl.sys_prompt_cn?.trim() ?? "";
}
