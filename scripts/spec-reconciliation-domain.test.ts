import assert from "node:assert/strict";
import test from "node:test";
import { mergeDescriptionText } from "../src/lib/spec-reconciliation/threeWayMerge";

test("현재 스펙이 그대로면 제안 전체 값을 적용한다", () => {
  const result = mergeDescriptionText("A\nB", "A\nB", "A\nB2");
  assert.deepEqual(result, {
    clean: true,
    merged: "A\nB2",
    conflicts: [],
  });
});

test("서로 다른 줄 변경은 보수적으로 3-way 병합한다", () => {
  const result = mergeDescriptionText(
    "첫째\n둘째\n셋째",
    "첫째-현재\n둘째\n셋째",
    "첫째\n둘째\n셋째-제안",
  );
  assert.equal(result.clean, true);
  if (result.clean) {
    assert.equal(result.merged, "첫째-현재\n둘째\n셋째-제안");
  }
});

test("같은 줄을 다르게 바꾸면 자동 병합하지 않는다", () => {
  const result = mergeDescriptionText(
    "첫째\n둘째\n셋째",
    "첫째\n둘째-현재\n셋째",
    "첫째\n둘째-제안\n셋째",
  );
  assert.equal(result.clean, false);
  if (!result.clean) {
    assert.equal(result.conflicts.length, 1);
    assert.deepEqual(result.conflicts[0]?.currentLines, ["둘째-현재"]);
    assert.deepEqual(result.conflicts[0]?.proposalLines, ["둘째-제안"]);
  }
});

test("양쪽이 같은 변경을 한 경우 한 번만 반영한다", () => {
  const result = mergeDescriptionText(
    "A\nB",
    "A\nB\nC",
    "A\nB\nC",
  );
  assert.deepEqual(result, {
    clean: true,
    merged: "A\nB\nC",
    conflicts: [],
  });
});
