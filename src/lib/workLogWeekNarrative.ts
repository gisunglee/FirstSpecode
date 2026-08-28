/**
 * workLogWeekNarrative — WEEK 업무일지의 계획/실적 필드 의미를 한곳에서 관리한다.
 *
 * 정상 매핑:
 *   - noteCn: 주간 계획
 *   - resultCn: 주간 실적
 *
 * 2026-07-25부터 업무일지의 "다음 주 계획 작성"이 resultCn에 저장되던 오류가 있었다.
 * 수정 전 저장된 값은 저장 시각이 대상 주 시작보다 이르고 noteCn이 비어 있는 경우에만
 * 계획으로 복구한다. 실제 주간 실적과 임의로 섞지 않기 위한 제한적인 호환 규칙이다.
 */

export type WeekNarrativeMode = "plan" | "result";

export type WeekNarrativeFields = {
  noteCn:   string | null;
  resultCn: string | null;
};

type StoredWeekNarrative = WeekNarrativeFields & {
  logDt:   Date | string;
  savedAt: Date | string;
};

export type NormalizedWeekNarrative = WeekNarrativeFields & {
  recoveredLegacyPlan: boolean;
};

function hasText(value: string | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function toTimestamp(value: Date | string): number {
  if (value instanceof Date) return value.getTime();
  const isoValue = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00Z`
    : value;
  return new Date(isoValue).getTime();
}

/** 수정 전 차주 계획이 resultCn에 들어간 레코드를 읽을 때 정상 의미로 복구한다. */
export function normalizeWeekNarrative(
  stored: StoredWeekNarrative,
): NormalizedWeekNarrative {
  const weekStartsAt = toTimestamp(stored.logDt);
  const savedAt = toTimestamp(stored.savedAt);
  const wasSavedBeforeWeek = Number.isFinite(weekStartsAt)
    && Number.isFinite(savedAt)
    && savedAt < weekStartsAt;

  const recoveredLegacyPlan = !hasText(stored.noteCn)
    && hasText(stored.resultCn)
    && wasSavedBeforeWeek;

  if (!recoveredLegacyPlan) {
    return {
      noteCn: stored.noteCn,
      resultCn: stored.resultCn,
      recoveredLegacyPlan: false,
    };
  }

  return {
    noteCn: stored.resultCn,
    resultCn: null,
    recoveredLegacyPlan: true,
  };
}

/** 화면의 "계획"과 "실적"이 각각 올바른 필드를 읽도록 한다. */
export function getWeekNarrativeValue(
  mode: WeekNarrativeMode,
  fields: WeekNarrativeFields,
): string {
  return mode === "plan"
    ? fields.noteCn ?? ""
    : fields.resultCn ?? "";
}

/** 한쪽 내용을 저장할 때 반대쪽 필드는 보존한다. */
export function buildWeekNarrativeUpdate(
  mode: WeekNarrativeMode,
  value: string,
  fields: WeekNarrativeFields,
): WeekNarrativeFields {
  if (mode === "plan") {
    return {
      noteCn: value,
      resultCn: fields.resultCn ?? "",
    };
  }

  return {
    noteCn: fields.noteCn ?? "",
    resultCn: value,
  };
}
