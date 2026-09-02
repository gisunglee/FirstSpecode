export type RequirementHistoryVersionMode = "minor" | "major" | undefined;

export type RequirementHistoryVersionPlan = {
  baselineVersion: "V1.0" | null;
  nextVersion: string;
};

export const INITIAL_REQUIREMENT_HISTORY_COMMENT = "최초 기준본 (변경 전)";

export function buildRequirementHistoryVersionPlan(
  lastVersion: string | null,
  mode: RequirementHistoryVersionMode,
): RequirementHistoryVersionPlan {
  if (!lastVersion) {
    return {
      baselineVersion: "V1.0",
      nextVersion: mode === "major" ? "V2.0" : "V1.1",
    };
  }

  const match = /^V(\d+)\.(\d+)$/.exec(lastVersion);
  if (!match) {
    throw new Error(`지원하지 않는 요구사항 이력 버전 형식입니다: ${lastVersion}`);
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);

  return {
    baselineVersion: null,
    nextVersion: mode === "major" ? `V${major + 1}.0` : `V${major}.${minor + 1}`,
  };
}
