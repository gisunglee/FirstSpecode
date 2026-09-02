import assert from "node:assert/strict";
import test from "node:test";

import { buildRequirementHistoryVersionPlan } from "../src/lib/requirementHistoryVersion";

test("첫 마이너 이력은 변경 전 V1.0과 변경 후 V1.1을 계획한다", () => {
  assert.deepEqual(buildRequirementHistoryVersionPlan(null, "minor"), {
    baselineVersion: "V1.0",
    nextVersion: "V1.1",
  });
});

test("첫 메이저 이력은 변경 전 V1.0과 변경 후 V2.0을 계획한다", () => {
  assert.deepEqual(buildRequirementHistoryVersionPlan(null, "major"), {
    baselineVersion: "V1.0",
    nextVersion: "V2.0",
  });
});

test("기존 이력이 있으면 기준본을 추가하지 않고 마이너 번호를 올린다", () => {
  assert.deepEqual(buildRequirementHistoryVersionPlan("V1.9", "minor"), {
    baselineVersion: null,
    nextVersion: "V1.10",
  });
});

test("기존 이력이 있으면 메이저 번호를 올리고 마이너 번호를 초기화한다", () => {
  assert.deepEqual(buildRequirementHistoryVersionPlan("V2.3", "major"), {
    baselineVersion: null,
    nextVersion: "V3.0",
  });
});

test("버전 모드가 없으면 마이너 이력으로 처리한다", () => {
  assert.deepEqual(buildRequirementHistoryVersionPlan("V1.0", undefined), {
    baselineVersion: null,
    nextVersion: "V1.1",
  });
});

test("잘못된 기존 버전은 조용히 덮어쓰지 않는다", () => {
  assert.throws(
    () => buildRequirementHistoryVersionPlan("1.0", "minor"),
    /지원하지 않는 요구사항 이력 버전 형식/,
  );
});
