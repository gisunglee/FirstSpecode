import assert from "node:assert/strict";
import test from "node:test";
import type {
  BatchScope,
  BatchTargetRef,
  EvidenceFile,
  FileAssignment,
} from "../src/lib/spec-reconciliation/batchContracts";
import { buildBatchDefinitions } from "../src/lib/spec-reconciliation/batchPartitioner";
import { mergeBatchProposalOrigins } from "../src/lib/spec-reconciliation/batchMerge";

const HASH = "a".repeat(64);

function target(index: number): BatchTargetRef {
  return {
    targetRefType: "FUNCTION",
    targetRefId: `target-${index}`,
    targetField: "func_dc",
    displayId: `FN-${index}`,
    name: `기능 ${index}`,
    description: `기능 ${index} 설명`,
    descriptionHash: HASH,
    hierarchy: {},
  };
}

function scope(key: string, targets = [target(1)]): BatchScope {
  return {
    key,
    type: "SCREEN",
    refId: key,
    name: key,
    targetRefs: targets,
    contextChars: targets.reduce((sum, item) => sum + item.description.length, 0),
  };
}

function evidence(path: string, patch = "+changed"): EvidenceFile {
  return { path, patch, symbols: [], raw: { path, patch } };
}

function assignment(path: string, scopeKeys: string[]): FileAssignment {
  return {
    path,
    scopeKeys,
    shared: scopeKeys.length > 1,
    confidence: "HIGH",
    reason: "test",
  };
}

test("파일 65개를 버리지 않고 30/30/5 배치로 분리한다", () => {
  const files = Array.from({ length: 65 }, (_, index) =>
    evidence(`src/file-${index}.ts`),
  );
  const definitions = buildBatchDefinitions(
    files,
    [scope("SCREEN:1")],
    files.map((file) => assignment(file.path, ["SCREEN:1"])),
  );

  assert.deepEqual(definitions.map((item) => item.files.length), [30, 30, 5]);
  assert.equal(
    new Set(definitions.flatMap((item) => item.files.map((file) => file.path))).size,
    65,
  );
});

test("한 파일의 큰 Diff도 잘라 버리지 않고 모든 segment를 배치한다", () => {
  const patch = "x".repeat(130_000);
  const definitions = buildBatchDefinitions(
    [evidence("src/large.ts", patch)],
    [scope("SCREEN:1")],
    [assignment("src/large.ts", ["SCREEN:1"])],
  );
  const parts = definitions.flatMap((item) => item.files);

  assert.equal(parts.length, 3);
  assert.equal(parts.map((part) => part.patch).join(""), patch);
  assert.deepEqual(parts.map((part) => part.partNo), [1, 2, 3]);
});

test("공통 파일의 120개 설계 대상을 최대 100개씩 나눈다", () => {
  const first = scope(
    "SCREEN:1",
    Array.from({ length: 60 }, (_, index) => target(index)),
  );
  const second = scope(
    "SCREEN:2",
    Array.from({ length: 60 }, (_, index) => target(index + 60)),
  );
  const definitions = buildBatchDefinitions(
    [evidence("src/shared.ts")],
    [first, second],
    [assignment("src/shared.ts", [first.key, second.key])],
  );

  assert.deepEqual(definitions.map((item) => item.targets.length), [100, 20]);
});

test("라우터가 연결하지 못한 파일도 UNMAPPED 배치에 남긴다", () => {
  const files = [evidence("src/unknown-a.ts"), evidence("src/unknown-b.ts")];
  const definitions = buildBatchDefinitions(
    files,
    [scope("SCREEN:1")],
    files.map((file) => assignment(file.path, [])),
  );

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].scope.type, "UNMAPPED");
  assert.deepEqual(
    definitions[0].files.map((file) => file.path),
    files.map((file) => file.path),
  );
});

function proposal(overrides: Partial<{
  beforeHash: string;
  proposedValue: string;
  classification: string;
  sourceFact: string;
  inferredImpact: string;
  risk: string;
  confidence: string;
}> = {}) {
  return {
    beforeHash: HASH,
    proposedValue: "변경 설명",
    classification: "SPEC_CHANGE",
    sourceFact: "확인 사실",
    inferredImpact: "영향",
    risk: "LOW",
    confidence: "HIGH",
    ...overrides,
  };
}

test("동일 제안은 중복 제거 대상으로 병합하고 위험도/확신을 보수적으로 합친다", () => {
  const result = mergeBatchProposalOrigins([
    { proposal: proposal() },
    {
      proposal: proposal({
        sourceFact: "추가 사실",
        risk: "HIGH",
        confidence: "LOW",
      }),
    },
  ]);

  assert.equal(result.conflict, false);
  assert.equal(result.risk, "HIGH");
  assert.equal(result.confidence, "LOW");
  assert.match(result.sourceFact, /확인 사실/);
  assert.match(result.sourceFact, /추가 사실/);
});

test("같은 대상의 값 또는 분류가 다르면 사람 선택 충돌로 남긴다", () => {
  assert.equal(
    mergeBatchProposalOrigins([
      { proposal: proposal() },
      { proposal: proposal({ proposedValue: "다른 설명" }) },
    ]).conflict,
    true,
  );
  assert.equal(
    mergeBatchProposalOrigins([
      { proposal: proposal() },
      { proposal: proposal({ classification: "SPEC_VIOLATION" }) },
    ]).conflict,
    true,
  );
});
