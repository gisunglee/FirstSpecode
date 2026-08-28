/**
 * WEEK 업무일지 계획/실적 매핑 회귀 테스트.
 *
 * 업무일지에서 차주 계획을 저장했는데 업무 리포트에는 보이지 않고, 다음 주 실적으로
 * 나타나던 오류가 다시 생기지 않도록 필드 의미와 과거 데이터 복구 규칙을 검증한다.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWeekNarrativeUpdate,
  getWeekNarrativeValue,
  normalizeWeekNarrative,
} from "../src/lib/workLogWeekNarrative";

test("계획은 noteCn에 저장하고 기존 실적은 보존한다", () => {
  const current = { noteCn: "기존 계획", resultCn: "기존 실적" };
  assert.deepEqual(buildWeekNarrativeUpdate("plan", "새 계획", current), {
    noteCn: "새 계획",
    resultCn: "기존 실적",
  });
  assert.equal(getWeekNarrativeValue("plan", current), "기존 계획");
});

test("실적은 resultCn에 저장하고 기존 계획은 보존한다", () => {
  const current = { noteCn: "기존 계획", resultCn: "기존 실적" };
  assert.deepEqual(buildWeekNarrativeUpdate("result", "새 실적", current), {
    noteCn: "기존 계획",
    resultCn: "새 실적",
  });
  assert.equal(getWeekNarrativeValue("result", current), "기존 실적");
});

test("대상 주 시작 전에 resultCn에 저장된 차주 계획을 계획으로 복구한다", () => {
  const normalized = normalizeWeekNarrative({
    noteCn: null,
    resultCn: "다음 주 배포 준비",
    logDt: "2026-08-31",
    savedAt: "2026-08-28T06:00:00.000Z",
  });

  assert.deepEqual(normalized, {
    noteCn: "다음 주 배포 준비",
    resultCn: null,
    recoveredLegacyPlan: true,
  });
});

test("대상 주가 시작된 뒤 작성한 resultCn은 실제 실적으로 유지한다", () => {
  const normalized = normalizeWeekNarrative({
    noteCn: null,
    resultCn: "월요일 배포 완료",
    logDt: "2026-08-31",
    savedAt: "2026-08-31T03:00:00.000Z",
  });

  assert.deepEqual(normalized, {
    noteCn: null,
    resultCn: "월요일 배포 완료",
    recoveredLegacyPlan: false,
  });
});

test("계획과 실적이 모두 있으면 저장 시각과 무관하게 그대로 유지한다", () => {
  const normalized = normalizeWeekNarrative({
    noteCn: "다음 주 계획",
    resultCn: "선작성 실적",
    logDt: "2026-08-31",
    savedAt: "2026-08-28T06:00:00.000Z",
  });

  assert.deepEqual(normalized, {
    noteCn: "다음 주 계획",
    resultCn: "선작성 실적",
    recoveredLegacyPlan: false,
  });
});
