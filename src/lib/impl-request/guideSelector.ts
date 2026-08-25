/**
 * impl-request/guideSelector — IMPLEMENT 태스크에 반영할 표준 가이드 조회
 *
 * 역할:
 *   - 프로젝트의 COMMON/SECURITY/ERROR 표준 가이드(항상 관련 있다고 보는 필수
 *     카테고리)를 조회해서 <표준가이드> 마크다운 블록으로 반환
 *   - 나머지 카테고리(DATA/AUTH/API/FILE/BATCH/REPORT/UI)는 "이 요청과 관련 있는지"
 *     판단할 LLM이 없는 순수 API 라우트에서는 다루지 않는다 — /review-uw처럼 Claude가
 *     제목을 보고 관련성을 판단하는 방식은 이 경로(서버 라우트)에 적용할 수 없다.
 *     관련성 필터링이 필요한 나머지 카테고리는 별도 설계 과제로 남겨둔다.
 */

import { prisma } from "@/lib/prisma";
import { GUIDE_CATEGORY_LABEL, type GuideCategory } from "@/constants/codes";
import { IMPLEMENTATION_ALWAYS_CATEGORIES } from "@/lib/standard-guides/usagePolicy";

/**
 * 프로젝트의 필수 카테고리 표준 가이드를 <표준가이드> 블록으로 반환.
 * 등록된 가이드가 없으면 null — 호출부에서 조용히 생략한다.
 */
export async function getMandatoryGuideBlock(projectId: string): Promise<string | null> {
  const guides = await prisma.tbSgStdGuide.findMany({
    where: {
      prjct_id: projectId,
      guide_ctgry_code: { in: [...IMPLEMENTATION_ALWAYS_CATEGORIES] },
      use_yn: "Y",
    },
    orderBy: [{ guide_ctgry_code: "asc" }, { mdfcn_dt: "desc" }, { creat_dt: "desc" }],
  });

  if (guides.length === 0) return null;

  const body = guides
    .map((g) => {
      const label = GUIDE_CATEGORY_LABEL[g.guide_ctgry_code as GuideCategory] ?? g.guide_ctgry_code;
      return `### [${label}] ${g.guide_sj}\n\n${g.guide_cn ?? ""}`;
    })
    .join("\n\n---\n\n");

  return `<표준가이드>\n${body}\n</표준가이드>`;
}
