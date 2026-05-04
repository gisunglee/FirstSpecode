/**
 * prompt-template/domain — 프롬프트 템플릿 도메인 분류 헬퍼
 *
 * 역할:
 *   - 프롬프트 템플릿을 두 도메인으로 분류 — "일반" vs "기획실"
 *   - 서버(route.ts)와 클라이언트(page.tsx) 가 같은 정의를 공유해서
 *     향후 도메인 분류 기준이 바뀌어도 이 파일 한 곳만 고치면 됨
 *
 * 분류 기준:
 *   - "plan-studio" : ref_ty_code === 'PLAN_STUDIO_ARTF'
 *   - "general"     : 그 외 (UNIT_WORK / SCREEN / AREA / FUNCTION / NULL)
 */

import type { Prisma } from "@prisma/client";

/** 화면 탭과 1:1 매칭되는 도메인 종류 */
export type PromptDomain = "general" | "plan-studio";

/** 프롬프트 템플릿 한 행이 어느 도메인인지 분류 */
export function classifyPromptDomain(refTyCode: string | null): PromptDomain {
  return refTyCode === "PLAN_STUDIO_ARTF" ? "plan-studio" : "general";
}

/**
 * Prisma where 절에 합칠 도메인 필터를 반환.
 * domain 이 null/undefined 면 빈 객체 — 호출부에서 스프레드해도 영향 없음.
 *
 * 주의: ref_ty_code 가 NULL 인 행도 "general" 에 포함되어야 하므로
 *       단순 not-equals 가 아니라 OR 조건을 사용한다 (NULL 은 "!= 'X'" 와 매칭 안 됨).
 */
export function buildPromptDomainWhere(
  domain: PromptDomain | null | undefined,
): Prisma.TbAiPromptTemplateWhereInput {
  if (domain === "plan-studio") {
    return { ref_ty_code: "PLAN_STUDIO_ARTF" };
  }
  if (domain === "general") {
    return {
      OR: [
        { ref_ty_code: null },
        { ref_ty_code: { not: "PLAN_STUDIO_ARTF" } },
      ],
    };
  }
  return {};
}

/** 쿼리 파라미터 문자열을 PromptDomain 으로 안전하게 파싱 (잘못된 값은 null) */
export function parsePromptDomain(raw: string | null): PromptDomain | null {
  if (raw === "general" || raw === "plan-studio") return raw;
  return null;
}
