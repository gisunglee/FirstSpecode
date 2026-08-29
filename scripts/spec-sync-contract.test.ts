/** 구현-설계 동기화의 문제 전용 결과 계약과 안전한 적용 조건을 검증한다. */

import assert from "node:assert/strict";
import test from "node:test";
import {
  syncAnalysisPayloadSchema,
  syncDecisionSchema,
  type DesignSnapshot,
  type SyncAnalysisPayload,
} from "../src/lib/spec-sync/contracts";
import { hashCanonicalValue, hashExactText } from "../src/lib/spec-sync/hash";
import { buildItemData } from "../src/lib/spec-sync/itemFactory";
import {
  assertDecisionEligible,
  validateSyncResult,
} from "../src/lib/spec-sync/resultValidator";
import { normalizeSyncSummary } from "../src/lib/spec-sync/summary";

const SNIPPET = "export async function POST() {}";
const SOURCE_PATH = "src/app/api/tasks/route.ts";
const CONTENT_HASH = "a".repeat(64);

const snapshot: DesignSnapshot = {
  projectId: "project-1",
  unitWork: { id: "uw-23", displayId: "UW-00023", name: "AI 태스크 관리" },
  requirements: [],
  userStories: [],
  acceptanceCriteria: [],
  apiRefs: [{ method: "POST", path: "/api/tasks" }],
  dbRefs: [{ table: "tb_ai_task" }],
  targets: [
    {
      targetType: "UNIT_WORK",
      targetId: "uw-23",
      targetField: "unit_work_dc",
      displayId: "UW-00023",
      name: "AI 태스크 관리",
      value: "AI 태스크를 조회하고 처리한다.",
      hierarchy: {
        unitWorkId: "uw-23",
        screenId: null,
        areaId: null,
        functionId: null,
      },
    },
    {
      targetType: "FUNCTION",
      targetId: "fn-1",
      targetField: "func_dc",
      displayId: "FN-00001",
      name: "태스크 실행",
      value: "대기 태스크를 실행한다.",
      hierarchy: {
        unitWorkId: "uw-23",
        screenId: "screen-1",
        areaId: "area-1",
        functionId: "fn-1",
      },
    },
  ],
};

function evidence(path = SOURCE_PATH) {
  return {
    path,
    symbol: "POST",
    startLine: 10,
    endLine: 20,
    snippet: SNIPPET,
    snippetHash: hashExactText(SNIPPET),
    redacted: false,
  };
}

function baseResult(): SyncAnalysisPayload {
  return {
    mode: "CHECK",
    sourceScope: {
      status: "CONFIRMED",
      files: [
        {
          path: SOURCE_PATH,
          symbols: ["POST"],
          kind: "PRIMARY",
          reason: "설계 API와 직접 일치",
          contentHash: CONTENT_HASH,
        },
      ],
      userConfirmed: false,
      confirmationNote: null,
    },
    implementation: {
      verdict: "PASS",
      summary: "두 설계 대상을 모두 확인했고 문제는 없다.",
      evaluatedTargets: snapshot.targets.map((target) => ({
        targetType: target.targetType,
        targetId: target.targetId,
        targetField: target.targetField,
      })),
      issues: [],
    },
    designCoverage: {
      verdict: "CLEAR",
      summary: "중요 설계 누락 후보가 없다.",
      issues: [],
    },
  };
}

function mismatchIssue() {
  return {
    targetType: "FUNCTION" as const,
    targetId: "fn-1",
    targetField: "func_dc" as const,
    resultCode: "MISMATCH" as const,
    designStatement: "대기 태스크를 실행한다.",
    sourceFact: "POST가 우선순위 순으로 태스크를 실행한다.",
    reason: "실행 순서가 설계에 없다.",
    evidence: [evidence()],
    confidence: "HIGH" as const,
    proposal: {
      targetType: "FUNCTION" as const,
      targetId: "fn-1",
      targetField: "func_dc" as const,
      proposedValue: "대기 태스크를 우선순위 순으로 실행한다.",
    },
  };
}

function asMutableResult() {
  return structuredClone(baseResult()) as any;
}

test("exact hash는 공백만 달라도 변경으로 본다", () => {
  assert.notEqual(hashExactText("설명"), hashExactText("설명 "));
});

test("canonical hash는 객체 key 순서와 무관하다", () => {
  assert.equal(
    hashCanonicalValue({ b: 2, a: { d: 4, c: 3 } }),
    hashCanonicalValue({ a: { c: 3, d: 4 }, b: 2 }),
  );
});

test("정상 결과는 상세 issue로 제출할 수 없다", () => {
  const result = asMutableResult();
  result.implementation.issues.push({
    ...mismatchIssue(),
    resultCode: "MATCH",
    proposal: null,
  });
  assert.equal(syncAnalysisPayloadSchema.safeParse(result).success, false);
});

test("실행 요약은 긴 항목 나열을 허용하지 않는다", () => {
  const result = asMutableResult();
  result.implementation.summary = "가".repeat(501);
  assert.equal(syncAnalysisPayloadSchema.safeParse(result).success, false);
});

test("정상 실행은 target 점검 완료만 검증하고 item을 만들지 않는다", () => {
  const validated = validateSyncResult(baseResult(), snapshot);
  const items = buildItemData("run-1", validated.analysis, validated.proposals, snapshot);
  assert.equal(items.length, 0);
});

test("snapshot의 모든 target을 점검 완료로 제출해야 한다", () => {
  const missing = baseResult();
  missing.implementation.evaluatedTargets.pop();
  assert.throws(() => validateSyncResult(missing, snapshot), /점검 완료 표시가 누락/);

  const fabricated = baseResult();
  fabricated.implementation.evaluatedTargets[1].targetId = "fabricated";
  assert.throws(() => validateSyncResult(fabricated, snapshot), /snapshot에 없는 점검 대상/);
});

test("확인된 MISMATCH는 sourceFact·evidence를 요구하고 proposal은 선택이다", () => {
  for (const missingField of ["sourceFact", "evidence"] as const) {
    const result = asMutableResult();
    const issue = mismatchIssue() as any;
    issue[missingField] = missingField === "evidence" ? [] : null;
    result.implementation.verdict = "FAIL";
    result.implementation.issues = [issue];
    assert.equal(syncAnalysisPayloadSchema.safeParse(result).success, false);
  }

  const withoutProposal = baseResult();
  withoutProposal.implementation.verdict = "FAIL";
  withoutProposal.implementation.issues.push({
    ...mismatchIssue(),
    proposal: null,
  });
  const validated = validateSyncResult(withoutProposal, snapshot);
  const items = buildItemData("run-1", validated.analysis, validated.proposals, snapshot);
  assert.equal(items[0].item_sttus_code, "PENDING");
  assert.equal(items[0].proposed_value_cn, null);
});

test("문제와 수정안만 PENDING item으로 저장한다", () => {
  const result = baseResult();
  result.implementation.verdict = "FAIL";
  result.implementation.issues.push(mismatchIssue());
  const validated = validateSyncResult(result, snapshot);
  const items = buildItemData("run-1", validated.analysis, validated.proposals, snapshot);
  assert.equal(items.length, 1);
  assert.equal(items[0].item_sttus_code, "PENDING");
  assert.equal(items[0].before_value_cn, "대기 태스크를 실행한다.");
  assert.equal(items[0].before_hash, hashExactText("대기 태스크를 실행한다."));
  assert.equal(items[0].proposed_value_cn, "대기 태스크를 우선순위 순으로 실행한다.");
});

test("proposal은 판정한 같은 설계 대상만 수정할 수 있다", () => {
  const result = baseResult();
  result.implementation.verdict = "FAIL";
  result.implementation.issues.push({
    ...mismatchIssue(),
    proposal: {
      targetType: "UNIT_WORK",
      targetId: "uw-23",
      targetField: "unit_work_dc",
      proposedValue: "다른 대상 설명",
    },
  });
  assert.throws(() => validateSyncResult(result, snapshot), /같은 설계 대상/);
});

test("UNKNOWN과 NOT_IMPLEMENTED에는 수정안을 만들 수 없다", () => {
  for (const resultCode of ["UNKNOWN", "NOT_IMPLEMENTED"] as const) {
    const result = asMutableResult();
    result.implementation.verdict = resultCode === "UNKNOWN" ? "UNKNOWN" : "FAIL";
    result.implementation.issues = [{
      ...mismatchIssue(),
      resultCode,
      evidence: [],
    }];
    assert.equal(syncAnalysisPayloadSchema.safeParse(result).success, false);
  }
});

test("기존 target에 연결한 설계 누락 후보도 proposal 없이 검토할 수 있다", () => {
  const result = baseResult();
  result.designCoverage.verdict = "GAP_CANDIDATE";
  result.designCoverage.issues = [{
    resultCode: "IMPORTANT_GAP_CANDIDATE",
    importance: "HIGH",
    targetType: "FUNCTION",
    targetId: "fn-1",
    targetField: "func_dc",
    designStatement: "대기 태스크를 실행한다.",
    sourceFact: "실패 태스크 재시도 기능도 제공한다.",
    reason: "사용자에게 보이는 상태 변경이다.",
    evidence: [evidence()],
    confidence: "HIGH",
    proposal: null,
  }];
  const validated = validateSyncResult(result, snapshot);
  const items = buildItemData("run-1", validated.analysis, validated.proposals, snapshot);
  assert.equal(items[0].item_sttus_code, "PENDING");
  assert.equal(items[0].proposed_value_cn, null);
});

test("신규 구조 후보는 target과 proposal 없이 근거만 제출한다", () => {
  const result = baseResult();
  result.designCoverage.verdict = "GAP_CANDIDATE";
  result.designCoverage.issues.push({
    resultCode: "STRUCTURE_GAP",
    importance: "HIGH",
    targetType: null,
    targetId: null,
    targetField: null,
    designStatement: null,
    sourceFact: "설계에 없는 관리 화면이 존재한다.",
    reason: "신규 화면 구조가 필요하다.",
    evidence: [evidence()],
    confidence: "HIGH",
    proposal: null,
  });
  assert.doesNotThrow(() => validateSyncResult(result, snapshot));
});

test("테스트 코드만으로 MISMATCH를 확정할 수 없다", () => {
  const result = baseResult();
  result.sourceScope.files[0].kind = "TEST";
  result.implementation.verdict = "FAIL";
  result.implementation.issues.push(mismatchIssue());
  assert.throws(() => validateSyncResult(result, snapshot), /테스트 코드만으로/);
});

test("사용자가 소스 범위를 확인했다면 확인 내용을 남긴다", () => {
  const result = asMutableResult();
  result.sourceScope.userConfirmed = true;
  result.sourceScope.confirmationNote = null;
  assert.equal(syncAnalysisPayloadSchema.safeParse(result).success, false);
});

test("CHECK는 일반 GAP_CANDIDATE를 반환할 수 없다", () => {
  const result = asMutableResult();
  result.designCoverage.verdict = "GAP_CANDIDATE";
  result.designCoverage.issues = [{
    resultCode: "GAP_CANDIDATE",
    importance: "NORMAL",
    targetType: null,
    targetId: null,
    targetField: null,
    designStatement: null,
    sourceFact: "일반 보조 기능이 있다.",
    reason: "정밀 모드에서만 검토한다.",
    evidence: [evidence()],
    confidence: "MEDIUM",
    proposal: null,
  }];
  assert.equal(syncAnalysisPayloadSchema.safeParse(result).success, false);
});

test("문제와 전체 verdict가 모순되면 거부한다", () => {
  const result = asMutableResult();
  result.implementation.issues = [mismatchIssue()];
  assert.equal(syncAnalysisPayloadSchema.safeParse(result).success, false);
});

test("확정 범위 밖 evidence와 위험 경로를 거부한다", () => {
  const outside = baseResult();
  outside.implementation.verdict = "FAIL";
  outside.implementation.issues.push({
    ...mismatchIssue(),
    evidence: [evidence("src/other/route.ts")],
  });
  assert.throws(() => validateSyncResult(outside, snapshot), /범위 밖/);

  const secret = baseResult();
  secret.sourceScope.files[0].path = ".env.local";
  secret.implementation.verdict = "FAIL";
  secret.implementation.issues.push({
    ...mismatchIssue(),
    evidence: [evidence(".env.local")],
  });
  assert.throws(() => validateSyncResult(secret, snapshot), /분석 제외 경로/);
});

test("서버는 마스킹되지 않은 credential snippet을 거부한다", () => {
  const result = baseResult();
  const secretSnippet = `const token = "${"sk_" + "A".repeat(24)}";`;
  result.implementation.verdict = "FAIL";
  result.implementation.issues.push({
    ...mismatchIssue(),
    evidence: [{
      ...evidence(),
      snippet: secretSnippet,
      snippetHash: hashExactText(secretSnippet),
    }],
  });
  assert.throws(() => validateSyncResult(result, snapshot), /credential이 제거되지 않은/);
});

test("구버전 정상 item도 요약에서 문제와 분리한다", () => {
  const summary = normalizeSyncSummary(null, [
    { finding_ty_code: "IMPLEMENTATION", result_code: "MATCH", item_sttus_code: "INFORMATIONAL" },
    { finding_ty_code: "IMPLEMENTATION", result_code: "MISMATCH", item_sttus_code: "PENDING" },
    { finding_ty_code: "DESIGN_COVERAGE", result_code: "OUT_OF_SCOPE", item_sttus_code: "INFORMATIONAL" },
  ]);
  assert.deepEqual(
    [summary.evaluatedTargetCount, summary.normalTargetCount, summary.issueCount, summary.pendingCount],
    [2, 1, 1, 1],
  );
});

test("INFORMATIONAL은 결정할 수 없고 APPLY에만 수정안이 필요하다", () => {
  assert.throws(() => assertDecisionEligible({
    itemStatus: "INFORMATIONAL",
    proposedValue: null,
    decision: "REJECT",
  }), /INVALID_ITEM_STATE/);
  assert.doesNotThrow(() => assertDecisionEligible({
    itemStatus: "PENDING",
    proposedValue: null,
    decision: "DEFER",
  }));
  assert.throws(() => assertDecisionEligible({
    itemStatus: "PENDING",
    proposedValue: null,
    decision: "APPLY",
  }), /INVALID_ITEM_STATE/);
});

test("REJECT와 DEFER에는 결정 사유가 필요하다", () => {
  assert.equal(syncDecisionSchema.safeParse({ decision: "REJECT", reason: "" }).success, false);
  assert.equal(syncDecisionSchema.safeParse({ decision: "DEFER", reason: "추가 확인" }).success, true);
});
