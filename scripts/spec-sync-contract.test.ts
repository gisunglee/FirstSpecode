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
  buildSourceDiscoveryPrompt,
  buildSyncAnalysisPrompt,
} from "../src/lib/spec-sync/prompts";
import {
  assertDecisionEligible,
  validateSyncResult,
} from "../src/lib/spec-sync/resultValidator";

const SNIPPET = "export async function POST() {}";

const snapshot: DesignSnapshot = {
  projectId: "project-1",
  unitWork: {
    id: "uw-23",
    displayId: "UW-00023",
    name: "AI 태스크 관리",
  },
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

function evidence(path = "src/app/api/tasks/route.ts") {
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
          path: "src/app/api/tasks/route.ts",
          symbols: ["POST"],
          kind: "PRIMARY",
          reason: "설계 API와 직접 일치",
        },
      ],
      userConfirmed: false,
      confirmationNote: null,
    },
    implementation: {
      verdict: "PASS",
      summary: "설계 기능이 구현돼 있다.",
      items: [
        {
          targetType: "UNIT_WORK",
          targetId: "uw-23",
          targetField: "unit_work_dc",
          resultCode: "MATCH",
          designStatement: "AI 시스템을 조회하고 처리한다.",
          sourceFact: "작업 API가 조회와 처리를 제공한다.",
          reason: "단위업무의 핵심 흐름이 구현되어 있다.",
          evidence: [evidence()],
          confidence: "HIGH",
          proposal: null,
        },
        {
          targetType: "FUNCTION",
          targetId: "fn-1",
          targetField: "func_dc",
          resultCode: "MATCH",
          designStatement: "대기 태스크를 실행한다.",
          sourceFact: "POST가 대기 태스크를 실행한다.",
          reason: "설계와 실행 경로가 일치한다.",
          evidence: [evidence()],
          confidence: "HIGH",
          proposal: null,
        },
      ],
    },
    designCoverage: {
      verdict: "CLEAR",
      summary: "중요 설계 누락 후보가 없다.",
      items: [],
    },
  };
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

test("CHECK와 DEEP_SYNC는 서로 다른 분석 지시를 사용한다", () => {
  const sourceScope = baseResult().sourceScope;
  const check = buildSyncAnalysisPrompt({
    mode: "CHECK",
    snapshot,
    sourceScope,
  });
  const deep = buildSyncAnalysisPrompt({
    mode: "DEEP_SYNC",
    snapshot,
    sourceScope,
  });

  assert.match(check, /일반 구현 세부사항.*보고하지 않는다/);
  assert.match(deep, /업무 동작을 역설계/);
  assert.doesNotMatch(
    check.replaceAll("\n", " "),
    /beforeValue와 beforeHash를 만들지 않는다.*baseline/,
  );
  assert.notEqual(check, deep);
  assert.match(buildSourceDiscoveryPrompt(snapshot), /인접 entrypoint/);
});

test("구현 PASS와 중요 설계 누락 후보를 동시에 보존한다", () => {
  const result = baseResult();
  result.designCoverage = {
    verdict: "GAP_CANDIDATE",
    summary: "중요 누락 후보 한 건",
    items: [
      {
        resultCode: "IMPORTANT_GAP_CANDIDATE",
        importance: "HIGH",
        targetType: "FUNCTION",
        targetId: "fn-1",
        targetField: "func_dc",
        designStatement: "대기 태스크를 실행한다.",
        sourceFact: "실패 태스크 재시도 기능도 제공한다.",
        reason: "사용자에게 보이는 상태 변경 기능이다.",
        evidence: [evidence()],
        confidence: "HIGH",
        proposal: {
          targetType: "FUNCTION",
          targetId: "fn-1",
          targetField: "func_dc",
          proposedValue: "대기 태스크 실행과 실패 태스크 재시도를 제공한다.",
        },
      },
    ],
  };

  const validated = validateSyncResult(result, snapshot);
  assert.equal(validated.analysis.implementation.verdict, "PASS");
  assert.equal(validated.analysis.designCoverage.verdict, "GAP_CANDIDATE");
  const proposal = [...validated.proposals.values()][0];
  assert.equal(proposal.beforeValue, "대기 태스크를 실행한다.");
  assert.equal(
    proposal.beforeHash,
    hashExactText("대기 태스크를 실행한다."),
  );
});

test("AI가 실행 UW snapshot에 없는 target을 만들면 거부한다", () => {
  const result = baseResult();
  result.implementation.items[1].targetId = "fabricated-target";
  assert.throws(
    () => validateSyncResult(result, snapshot),
    /snapshot에 없는 구현 정합성 대상/,
  );
});

test("검증된 수정안만 before/hash와 함께 PENDING 항목으로 저장한다", () => {
  const result = baseResult();
  result.implementation.items[1].resultCode = "MISMATCH";
  result.implementation.verdict = "FAIL";
  result.implementation.items[1].proposal = {
    targetType: "FUNCTION",
    targetId: "fn-1",
    targetField: "func_dc",
    proposedValue: "대기 태스크를 우선순위 순으로 실행한다.",
  };
  const validated = validateSyncResult(result, snapshot);
  const items = buildItemData(
    "run-1",
    validated.analysis,
    validated.proposals,
    snapshot,
  );
  const mismatch = items.find((item) => item.target_ref_id === "fn-1");
  const match = items.find((item) => item.target_ref_id === "uw-23");
  assert.equal(match?.item_sttus_code, "INFORMATIONAL");
  assert.equal(mismatch?.item_sttus_code, "PENDING");
  assert.equal(mismatch?.before_value_cn, "대기 태스크를 실행한다.");
  assert.equal(
    mismatch?.before_hash,
    hashExactText("대기 태스크를 실행한다."),
  );
  assert.equal(
    mismatch?.proposed_value_cn,
    "대기 태스크를 우선순위 순으로 실행한다.",
  );
});

test("proposal은 판정한 같은 설계 대상만 수정할 수 있다", () => {
  const result = baseResult();
  result.implementation.items[1].resultCode = "MISMATCH";
  result.implementation.verdict = "FAIL";
  result.implementation.items[1].proposal = {
    targetType: "UNIT_WORK",
    targetId: "uw-23",
    targetField: "unit_work_dc",
    proposedValue: "다른 대상 설명",
  };
  assert.throws(() => validateSyncResult(result, snapshot), /같은 설계 대상/);
});

test("빈 설계 수정안은 거부한다", () => {
  const result = baseResult();
  result.implementation.items[1].resultCode = "MISMATCH";
  result.implementation.verdict = "FAIL";
  result.implementation.items[1].proposal = {
    targetType: "FUNCTION",
    targetId: "fn-1",
    targetField: "func_dc",
    proposedValue: "   ",
  };
  assert.equal(syncAnalysisPayloadSchema.safeParse(result).success, false);
});

test("UNKNOWN 판정에는 적용 가능한 수정안을 만들 수 없다", () => {
  const implementation = baseResult();
  implementation.implementation.items[1].resultCode = "UNKNOWN";
  implementation.implementation.verdict = "UNKNOWN";
  implementation.implementation.items[1].proposal = {
    targetType: "FUNCTION",
    targetId: "fn-1",
    targetField: "func_dc",
    proposedValue: "근거가 불확실한 수정안",
  };
  assert.equal(syncAnalysisPayloadSchema.safeParse(implementation).success, false);

  const coverage = baseResult();
  coverage.designCoverage.verdict = "UNKNOWN";
  coverage.designCoverage.items.push({
    resultCode: "UNKNOWN",
    importance: "NORMAL",
    targetType: "FUNCTION",
    targetId: "fn-1",
    targetField: "func_dc",
    designStatement: null,
    sourceFact: "업무 동작인지 확인되지 않았다.",
    reason: "호출 경로가 불명확하다.",
    evidence: [],
    confidence: "LOW",
    proposal: {
      targetType: "FUNCTION",
      targetId: "fn-1",
      targetField: "func_dc",
      proposedValue: "근거가 불확실한 수정안",
    },
  });
  assert.equal(syncAnalysisPayloadSchema.safeParse(coverage).success, false);
});

test("NOT_IMPLEMENTED에는 설계 삭제로 이어질 수정안을 만들 수 없다", () => {
  const result = baseResult();
  result.implementation.items[1].resultCode = "NOT_IMPLEMENTED";
  result.implementation.verdict = "FAIL";
  result.implementation.items[1].proposal = {
    targetType: "FUNCTION",
    targetId: "fn-1",
    targetField: "func_dc",
    proposedValue: "미구현이므로 설계에서 제거한다.",
  };
  assert.equal(syncAnalysisPayloadSchema.safeParse(result).success, false);
});

test("확인된 커버리지 판정에는 코드 근거가 필요하다", () => {
  const result = baseResult();
  result.designCoverage.verdict = "GAP_CANDIDATE";
  result.designCoverage.items.push({
    resultCode: "STRUCTURE_GAP",
    importance: "HIGH",
    targetType: null,
    targetId: null,
    targetField: null,
    designStatement: null,
    sourceFact: "설계에 없는 관리 화면이 존재한다.",
    reason: "신규 화면 구조가 필요하다.",
    evidence: [],
    confidence: "HIGH",
    proposal: null,
  });
  assert.equal(syncAnalysisPayloadSchema.safeParse(result).success, false);
});

test("테스트 코드만으로 현재 구현을 확정할 수 없다", () => {
  const result = baseResult();
  result.sourceScope.files[0].kind = "TEST";
  assert.throws(
    () => validateSyncResult(result, snapshot),
    /테스트 코드만으로 현재 구현 사실을 확정할 수 없습니다/,
  );
});

test("사용자가 소스 범위를 확인했다면 확인 내용을 남긴다", () => {
  const result = baseResult();
  result.sourceScope.userConfirmed = true;
  result.sourceScope.confirmationNote = null;
  assert.equal(syncAnalysisPayloadSchema.safeParse(result).success, false);
});

test("CHECK는 일반 GAP_CANDIDATE를 반환할 수 없다", () => {
  const result = baseResult();
  result.designCoverage.items.push({
    resultCode: "GAP_CANDIDATE",
    importance: "NORMAL",
    targetType: null,
    targetId: null,
    targetField: null,
    designStatement: null,
    sourceFact: "내부 캐시가 있다.",
    reason: "정밀 모드에서만 검토할 항목",
    evidence: [evidence()],
    confidence: "MEDIUM",
    proposal: null,
  });
  assert.equal(syncAnalysisPayloadSchema.safeParse(result).success, false);
});

test("MATCH와 MISMATCH는 코드 evidence가 없으면 거부한다", () => {
  const result = baseResult();
  result.implementation.items[0].evidence = [];
  assert.equal(syncAnalysisPayloadSchema.safeParse(result).success, false);
});

test("항목과 전체 verdict가 모순되면 거부한다", () => {
  const result = baseResult();
  result.implementation.items[0].resultCode = "MISMATCH";
  assert.equal(syncAnalysisPayloadSchema.safeParse(result).success, false);
});

test("확정 범위 밖 evidence와 위험 경로를 거부한다", () => {
  const outside = baseResult();
  outside.implementation.items[0].evidence = [evidence("src/other/route.ts")];
  assert.throws(() => validateSyncResult(outside, snapshot), /범위 밖/);

  const secret = baseResult();
  secret.sourceScope.files[0].path = ".env.local";
  secret.implementation.items.forEach((item) => {
    item.evidence = [evidence(".env.local")];
  });
  assert.throws(() => validateSyncResult(secret, snapshot), /분석 제외 경로/);
});

test("서버 검증도 마스킹되지 않은 credential snippet을 거부한다", () => {
  const result = baseResult();
  const secretSnippet = `const token = "${"sk_" + "A".repeat(24)}";`;
  result.implementation.items[0].evidence = [
    {
      ...evidence(),
      snippet: secretSnippet,
      snippetHash: hashExactText(secretSnippet),
    },
  ];
  assert.throws(
    () => validateSyncResult(result, snapshot),
    /credential이 제거되지 않은 evidence/,
  );
});

test("INFORMATIONAL은 차단하고 APPLY에만 수정안을 요구한다", () => {
  assert.throws(
    () =>
      assertDecisionEligible({
        itemStatus: "INFORMATIONAL",
        proposedValue: null,
        decision: "REJECT",
      }),
    /INVALID_ITEM_STATE/,
  );
  assert.doesNotThrow(() =>
    assertDecisionEligible({
      itemStatus: "PENDING",
      proposedValue: null,
      decision: "REJECT",
    }),
  );
  assert.doesNotThrow(() =>
    assertDecisionEligible({
      itemStatus: "PENDING",
      proposedValue: null,
      decision: "DEFER",
    }),
  );
  assert.throws(
    () =>
      assertDecisionEligible({
        itemStatus: "PENDING",
        proposedValue: null,
        decision: "APPLY",
      }),
    /INVALID_ITEM_STATE/,
  );
  assert.doesNotThrow(() =>
    assertDecisionEligible({
      itemStatus: "PENDING",
      proposedValue: "새 설명",
      decision: "APPLY",
    }),
  );
});

test("REJECT와 DEFER에는 결정 사유가 필요하다", () => {
  assert.equal(
    syncDecisionSchema.safeParse({ decision: "REJECT", reason: "" }).success,
    false,
  );
  assert.equal(
    syncDecisionSchema.safeParse({ decision: "DEFER", reason: "추가 확인" })
      .success,
    true,
  );
});

test("5개 UW Shadow 계약 사례가 서로 다른 판정을 보존한다", () => {
  const cases = [
    { uw: "UW-00001", implementation: "MATCH", coverage: "CLEAR" },
    { uw: "UW-00014", implementation: "MISMATCH", coverage: "CLEAR" },
    {
      uw: "UW-00020",
      implementation: "NOT_IMPLEMENTED",
      coverage: "CLEAR",
    },
    {
      uw: "UW-00023",
      implementation: "MATCH",
      coverage: "IMPORTANT_GAP_CANDIDATE",
    },
    { uw: "UW-00036", implementation: "UNKNOWN", coverage: "UNKNOWN" },
  ] as const;

  assert.equal(cases.length, 5);
  assert.deepEqual(
    new Set(cases.map((item) => item.implementation)),
    new Set(["MATCH", "MISMATCH", "NOT_IMPLEMENTED", "UNKNOWN"]),
  );
  assert.ok(
    cases.some(
      (item) =>
        item.implementation === "MATCH" &&
        item.coverage === "IMPORTANT_GAP_CANDIDATE",
    ),
  );
});
