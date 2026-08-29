/** 동기화 실행의 문제 항목과 정상/문제 건수 요약을 신·구 결과에 동일하게 계산한다. */

const NON_ISSUE_RESULT_CODES = new Set([
  "MATCH",
  "IMPLEMENTATION_DETAIL",
  "OUT_OF_SCOPE",
]);

type SummaryItem = {
  finding_ty_code: string;
  result_code: string;
  item_sttus_code: string;
};

export type NormalizedSyncSummary = {
  implementation?: string;
  designCoverage?: string;
  evaluatedTargetCount: number;
  normalTargetCount: number;
  issueCount: number;
  implementationIssueCount: number;
  coverageIssueCount: number;
  pendingCount: number;
};

export function isSyncIssueResult(resultCode: string) {
  return !NON_ISSUE_RESULT_CODES.has(resultCode);
}

/**
 * 새 실행은 summary에 전체 점검 수를 기록하고 문제 item만 저장한다.
 * 전환 전 실행은 정상 item도 있으므로 DB item에서 동일한 숫자를 복원한다.
 */
export function normalizeSyncSummary(
  rawSummary: unknown,
  items: SummaryItem[],
): NormalizedSyncSummary {
  const summary = asRecord(rawSummary);
  const implementationItems = items.filter(
    (item) => item.finding_ty_code === "IMPLEMENTATION",
  );
  const issueItems = items.filter((item) => isSyncIssueResult(item.result_code));
  const implementationIssueCount = implementationItems.filter((item) =>
    isSyncIssueResult(item.result_code),
  ).length;
  const coverageIssueCount = issueItems.length - implementationIssueCount;

  return {
    ...(typeof summary.implementation === "string"
      ? { implementation: summary.implementation }
      : {}),
    ...(typeof summary.designCoverage === "string"
      ? { designCoverage: summary.designCoverage }
      : {}),
    evaluatedTargetCount: numberValue(
      summary.evaluatedTargetCount,
      implementationItems.length,
    ),
    normalTargetCount: numberValue(
      summary.normalTargetCount,
      implementationItems.length - implementationIssueCount,
    ),
    issueCount: numberValue(summary.issueCount, issueItems.length),
    implementationIssueCount: numberValue(
      summary.implementationIssueCount,
      implementationIssueCount,
    ),
    coverageIssueCount: numberValue(
      summary.coverageIssueCount,
      coverageIssueCount,
    ),
    pendingCount: issueItems.filter(
      (item) => item.item_sttus_code === "PENDING",
    ).length,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}
