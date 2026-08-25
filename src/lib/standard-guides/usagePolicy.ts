import type { GuideCategory } from "@/constants/codes";

export type GuideUsageLevel = "ALWAYS" | "CONDITIONAL" | "NONE";
export type GuideUsageKey = "REVIEW_UW" | "IMPLEMENT_REQUEST" | "SYNC_SPECODE";

export type GuideUsage = {
  key: GuideUsageKey;
  label: string;
  level: GuideUsageLevel;
  description: string;
};

export const IMPLEMENTATION_ALWAYS_CATEGORIES: readonly GuideCategory[] = [
  "COMMON",
  "SECURITY",
  "ERROR",
];

function isImplementationAlwaysCategory(category: GuideCategory) {
  return IMPLEMENTATION_ALWAYS_CATEGORIES.includes(category);
}

export function getStandardGuideUsages(
  category: GuideCategory,
  useYn: string,
): GuideUsage[] {
  const inactive = useYn !== "Y";
  const reviewAlways = category === "UI" || isImplementationAlwaysCategory(category);
  const implementationAlways = isImplementationAlwaysCategory(category);

  return [
    {
      key: "REVIEW_UW",
      label: "/review-uw",
      level: inactive ? "NONE" : reviewAlways ? "ALWAYS" : "CONDITIONAL",
      description: inactive
        ? "미사용 상태라 검토 기준에서 제외됩니다."
        : reviewAlways
          ? "모든 단위업무 검토에 기준 문서로 전달됩니다."
          : "제목이 단위업무와 관련 있다고 판단될 때만 전달됩니다.",
    },
    {
      key: "IMPLEMENT_REQUEST",
      label: "구현 요청",
      level: inactive || !implementationAlways ? "NONE" : "ALWAYS",
      description: inactive
        ? "미사용 상태라 구현 요청에 포함되지 않습니다."
        : implementationAlways
          ? "모든 구현 요청의 공통 기준으로 자동 포함됩니다."
          : "현재 카테고리는 구현 요청에 자동 포함되지 않습니다.",
    },
    {
      key: "SYNC_SPECODE",
      label: "/sync-specode",
      level: "NONE",
      description: "현재 구현-설계 동기화에서는 표준 가이드를 자동 참조하지 않습니다.",
    },
  ];
}

export function getStandardGuideListUsage(
  category: GuideCategory,
  useYn: string,
): { level: GuideUsageLevel; label: string } {
  if (useYn !== "Y") return { level: "NONE", label: "자동 참조 안 함" };
  if (isImplementationAlwaysCategory(category)) {
    return { level: "ALWAYS", label: "개발·검토 항상" };
  }
  if (category === "UI") return { level: "ALWAYS", label: "검토 시 항상" };
  return { level: "CONDITIONAL", label: "관련 UW만" };
}

export function getStandardGuideWritingHint(
  category: GuideCategory,
  useYn: string,
): string {
  if (useYn !== "Y") {
    return "미사용 가이드는 보관만 하며 AI가 자동으로 읽지 않습니다.";
  }
  if (isImplementationAlwaysCategory(category)) {
    return "모든 개발과 검토에 전달됩니다. 반복 설명보다 반드시 지킬 공통 규칙을 간결하게 작성하세요.";
  }
  if (category === "UI") {
    return "모든 UI 검토에 전달됩니다. 디자인 원칙과 확인 기준을 구체적으로 작성하세요.";
  }
  return "제목이 관련 가이드 선택 기준입니다. 적용 기술·기능·대상을 제목에 구체적으로 적으세요.";
}
