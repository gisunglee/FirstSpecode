import assert from "node:assert/strict";
import test from "node:test";
import type { GuideCategory } from "../src/constants/codes";
import {
  getStandardGuideListUsage,
  getStandardGuideUsages,
} from "../src/lib/standard-guides/usagePolicy";

const mandatory: GuideCategory[] = ["COMMON", "SECURITY", "ERROR"];
const conditional: GuideCategory[] = ["DATA", "AUTH", "API", "FILE", "BATCH", "REPORT"];

test("공통·보안·에러는 검토와 구현 요청에서 항상 참조한다", () => {
  for (const category of mandatory) {
    const usages = getStandardGuideUsages(category, "Y");
    assert.equal(usages.find((usage) => usage.key === "REVIEW_UW")?.level, "ALWAYS");
    assert.equal(usages.find((usage) => usage.key === "IMPLEMENT_REQUEST")?.level, "ALWAYS");
    assert.equal(getStandardGuideListUsage(category, "Y").label, "개발 · UW 검토");
  }
});

test("UI는 검토에서만 항상 참조한다", () => {
  const usages = getStandardGuideUsages("UI", "Y");
  assert.equal(usages.find((usage) => usage.key === "REVIEW_UW")?.level, "ALWAYS");
  assert.equal(usages.find((usage) => usage.key === "IMPLEMENT_REQUEST")?.level, "NONE");
  assert.equal(getStandardGuideListUsage("UI", "Y").label, "UW 검토");
});

test("선택 카테고리는 관련 UW 검토에서만 참조한다", () => {
  for (const category of conditional) {
    const usages = getStandardGuideUsages(category, "Y");
    assert.equal(usages.find((usage) => usage.key === "REVIEW_UW")?.level, "CONDITIONAL");
    assert.equal(usages.find((usage) => usage.key === "IMPLEMENT_REQUEST")?.level, "NONE");
    assert.equal(getStandardGuideListUsage(category, "Y").label, "관련 UW 검토");
  }
});

test("미사용 가이드와 sync-specode는 자동 참조하지 않는다", () => {
  for (const category of [...mandatory, "UI", ...conditional] as GuideCategory[]) {
    assert.ok(getStandardGuideUsages(category, "N").every((usage) => usage.level === "NONE"));
  }
  assert.equal(
    getStandardGuideUsages("COMMON", "Y").find((usage) => usage.key === "SYNC_SPECODE")?.level,
    "NONE",
  );
});

test("사용 위치에는 사용자가 실제 실행하는 커맨드를 표시한다", () => {
  const usages = getStandardGuideUsages("COMMON", "Y");
  assert.equal(usages.find((usage) => usage.key === "IMPLEMENT_REQUEST")?.label, "/run-ai-tasks IMP");
  assert.equal(usages.find((usage) => usage.key === "REVIEW_UW")?.label, "/review-uw UW-XXXXX");
  assert.equal(usages.find((usage) => usage.key === "SYNC_SPECODE")?.label, "/sync-specode UW-XXXXX");
});
