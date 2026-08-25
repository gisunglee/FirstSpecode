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
      key: "IMPLEMENT_REQUEST",
      label: "/run-ai-tasks IMP",
      level: inactive || !implementationAlways ? "NONE" : "ALWAYS",
      description: inactive
        ? "미사용 상태라 AI 개발 작업에 포함되지 않습니다."
        : implementationAlways
          ? "구현 요청에 자동 포함되며 /run-ai-tasks IMP로 개발할 때 기준으로 사용됩니다."
          : "현재 카테고리는 AI 개발 작업에 자동 포함되지 않습니다.",
    },
    {
      key: "REVIEW_UW",
      label: "/review-uw UW-XXXXX",
      level: inactive ? "NONE" : reviewAlways ? "ALWAYS" : "CONDITIONAL",
      description: inactive
        ? "미사용 상태라 검토 기준에서 제외됩니다."
        : reviewAlways
          ? "모든 단위업무 검토에 기준 문서로 전달됩니다."
          : "제목이 단위업무와 관련 있다고 판단될 때만 전달됩니다.",
    },
    {
      key: "SYNC_SPECODE",
      label: "/sync-specode UW-XXXXX",
      level: "NONE",
      description: "현재 구현-설계 동기화에서는 표준 가이드를 자동 참조하지 않습니다.",
    },
  ];
}

export function getStandardGuideListUsage(
  category: GuideCategory,
  useYn: string,
): { level: GuideUsageLevel; label: string; description: string } {
  if (useYn !== "Y") {
    return {
      level: "NONE",
      label: "사용 안 함",
      description: "미사용 상태라 AI 개발·UW 검토·설계 동기화 어디에서도 자동 참조하지 않습니다.",
    };
  }
  if (isImplementationAlwaysCategory(category)) {
    return {
      level: "ALWAYS",
      label: "개발 · UW 검토",
      description: "/run-ai-tasks IMP 개발과 /review-uw UW-XXXXX 검토에서 항상 참조합니다.",
    };
  }
  if (category === "UI") {
    return {
      level: "ALWAYS",
      label: "UW 검토",
      description: "/review-uw UW-XXXXX 검토에서 항상 참조합니다.",
    };
  }
  return {
    level: "CONDITIONAL",
    label: "관련 UW 검토",
    description: "/review-uw UW-XXXXX 실행 시 제목이 해당 단위업무와 관련 있다고 판단될 때 참조합니다.",
  };
}

export function getStandardGuideWritingHint(
  category: GuideCategory,
  useYn: string,
): string {
  if (useYn !== "Y") {
    return "미사용 가이드는 보관만 하며 AI가 자동으로 읽지 않습니다.";
  }
  if (isImplementationAlwaysCategory(category)) {
    return "AI 개발과 UW 검토에 전달됩니다. 반복 설명보다 반드시 지킬 공통 규칙을 간결하게 작성하세요.";
  }
  if (category === "UI") {
    return "모든 UW의 UI 검토에 전달됩니다. 디자인 원칙과 확인 기준을 구체적으로 작성하세요.";
  }
  return "제목이 관련 가이드 선택 기준입니다. 적용 기술·기능·대상을 제목에 구체적으로 적으세요.";
}
