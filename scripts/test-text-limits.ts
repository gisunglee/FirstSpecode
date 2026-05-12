/**
 * test-text-limits.ts — 텍스트 길이 제한 정책 단위 테스트
 *
 * 실행: npm run test:text-limits
 *
 * 목적:
 *   - countChars / validateTextLimit / TextLimitError 동작 검증
 *   - TEXT_LIMITS / TEXT_LIMIT_LABEL 스냅샷 회귀 방지
 *
 * 한도 값/라벨을 **의도적으로 바꾸는** 경우 EXPECTED_* 도 함께 수정.
 *
 * 적용 범위:
 *   apiTextLimitGuard 는 next/server 의존성으로 단위 테스트 제외 — 라우트 통합 시점에 동작 확인.
 *   본 테스트는 한도 정책의 진실(글자수 산정·throw 동작)만 검증.
 */

import {
  TEXT_LIMITS,
  TEXT_LIMIT_LABEL,
  TextLimitError,
  validateTextLimit,
  countChars,
  apiTextLimitGuard,
} from "../src/lib/constants/textLimits";

// ── 결과 누적 ────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
const failures: string[] = [];

function ok(label: string) {
  console.log(`✅  ${label}`);
  passed++;
}
function fail(label: string, expected: unknown, actual: unknown) {
  console.log(`❌  ${label}`);
  console.log(`      expected: ${JSON.stringify(expected)}`);
  console.log(`      actual:   ${JSON.stringify(actual)}`);
  failures.push(label);
  failed++;
}

function assertEq<T>(label: string, actual: T, expected: T) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) ok(label);
  else fail(label, expected, actual);
}

function assertThrows(label: string, fn: () => void, errorPredicate: (e: unknown) => boolean) {
  try {
    fn();
    fail(label, "throw", "no-throw");
  } catch (e) {
    if (errorPredicate(e)) ok(label);
    else fail(label, "matching-error", e);
  }
}

// ── 1. countChars — 글자수 계산 ──────────────────────────────────────────────

console.log("=".repeat(80));
console.log("1) countChars — Unicode code point 기반 글자수");
console.log("=".repeat(80));

assertEq("빈 문자열 → 0",                    countChars(""),                    0);
assertEq("영문 'hello' → 5",                  countChars("hello"),               5);
assertEq("한글 '안녕하세요' → 5",             countChars("안녕하세요"),         5);
assertEq("혼합 'Hi 안녕' → 5",                countChars("Hi 안녕"),             5);
assertEq("줄바꿈 'a\\nb' → 3",                countChars("a\nb"),                3);

// 이모지 — String.length 는 surrogate pair 로 2 카운트, countChars 는 1
assertEq("이모지 '✅' → 1 (BMP)",             countChars("✅"),                  1);
assertEq("이모지 '🎯' → 1 (서로게이트 페어)",  countChars("🎯"),                  1);
assertEq("이모지 2개 '🎯✅' → 2",             countChars("🎯✅"),                2);

// 50,000자 데이터 — 시간 측정 포함 (성능 회귀 방지)
const big = "가".repeat(50_000);
const t0  = performance.now();
const cnt = countChars(big);
const dt  = performance.now() - t0;
assertEq("50,000자 → 정확히 50,000",          cnt,                               50_000);
console.log(`   (소요 ${dt.toFixed(1)}ms — 100ms 이내면 OK)`);

// ── 2. TEXT_LIMITS 스냅샷 ────────────────────────────────────────────────────

console.log("\n" + "=".repeat(80));
console.log("2) TEXT_LIMITS — 한도 값 스냅샷 회귀 방지");
console.log("=".repeat(80));

assertEq("TEXT_LIMITS 전체", TEXT_LIMITS, {
  name:           200,
  displayId:      50,
  comment:        2_000,
  description:    50_000,
  detailSpec:     50_000,
  analysisMemo:   50_000,
  taskDefinition: 50_000,
  htmlContent:   100_000,
});

// ── 3. TEXT_LIMIT_LABEL 스냅샷 ───────────────────────────────────────────────

console.log("\n" + "=".repeat(80));
console.log("3) TEXT_LIMIT_LABEL — 사용자 노출 라벨 스냅샷");
console.log("=".repeat(80));

assertEq("TEXT_LIMIT_LABEL 전체", TEXT_LIMIT_LABEL, {
  name:           "이름",
  displayId:      "표시 ID",
  comment:        "코멘트",
  description:    "설명",
  detailSpec:     "상세 명세",
  analysisMemo:   "분석 메모",
  taskDefinition: "과업 본문",
  htmlContent:    "본문",
});

// ── 4. validateTextLimit — 통과 케이스 ───────────────────────────────────────

console.log("\n" + "=".repeat(80));
console.log("4) validateTextLimit — 통과 케이스 (throw 없어야 함)");
console.log("=".repeat(80));

function shouldNotThrow(label: string, fn: () => void) {
  try { fn(); ok(label); }
  catch (e) { fail(label, "no-throw", e); }
}

shouldNotThrow("undefined 통과",                     () => validateTextLimit("name", undefined));
shouldNotThrow("null 통과",                          () => validateTextLimit("name", null));
shouldNotThrow("빈 문자열 통과",                       () => validateTextLimit("name", ""));
shouldNotThrow("문자열 아닌 값 통과(타입 검증은 별도)", () => validateTextLimit("name", 12345));
shouldNotThrow("한도 정확히 통과 (200자)",             () => validateTextLimit("name", "a".repeat(200)));
shouldNotThrow("한도 1자 미만 통과",                   () => validateTextLimit("name", "a".repeat(199)));
shouldNotThrow("description 50,000자 통과",           () => validateTextLimit("description", "가".repeat(50_000)));
shouldNotThrow("htmlContent 100,000자 통과",          () => validateTextLimit("htmlContent",  "x".repeat(100_000)));

// ── 5. validateTextLimit — 초과 시 throw ────────────────────────────────────

console.log("\n" + "=".repeat(80));
console.log("5) validateTextLimit — 한도 초과 시 TextLimitError throw");
console.log("=".repeat(80));

assertThrows(
  "name 201자 → throw TextLimitError",
  () => validateTextLimit("name", "a".repeat(201)),
  (e) => e instanceof TextLimitError && e.field === "name" && e.current === 201 && e.max === 200
);

assertThrows(
  "description 50,001자 → throw TextLimitError",
  () => validateTextLimit("description", "가".repeat(50_001)),
  (e) => e instanceof TextLimitError && e.field === "description" && e.current === 50_001
);

assertThrows(
  "displayId 51자 → throw",
  () => validateTextLimit("displayId", "a".repeat(51)),
  (e) => e instanceof TextLimitError && e.field === "displayId" && e.max === 50
);

// 이모지 글자수 검사 — surrogate pair 가 1로 집계되는지 (= 한도 더 들어감)
assertThrows(
  "이모지 100,001개 → htmlContent 한도 초과",
  () => validateTextLimit("htmlContent", "🎯".repeat(100_001)),
  (e) => e instanceof TextLimitError && e.current === 100_001
);

// ── 6. TextLimitError 메시지 포맷 ────────────────────────────────────────────

console.log("\n" + "=".repeat(80));
console.log("6) TextLimitError — 사용자 메시지 포맷");
console.log("=".repeat(80));

try {
  validateTextLimit("description", "가".repeat(50_001));
  fail("메시지 검증을 위한 throw", "throw", "no-throw");
} catch (e) {
  if (e instanceof TextLimitError) {
    const expectedSubstr = ["설명", "50,000", "50,001"];
    const allFound = expectedSubstr.every((s) => e.message.includes(s));
    if (allFound) ok(`메시지에 라벨/한도/현재값 포함: "${e.message}"`);
    else fail("메시지 포맷", `포함: ${expectedSubstr.join(", ")}`, e.message);
  } else {
    fail("TextLimitError 인스턴스", "TextLimitError", e);
  }
}

// ── 7. apiTextLimitGuard — 라우트 가드 동작 ─────────────────────────────────
// NextResponse 객체 반환 여부와 페이로드 정합성 검사.
// (next/server runtime import 가 tsx 에서 동작해야 함 — 실패 시 이 블록만 스킵)

console.log("\n" + "=".repeat(80));
console.log("7) apiTextLimitGuard — 라우트 가드");
console.log("=".repeat(80));

// 7-1. 모두 통과면 null
{
  const r = apiTextLimitGuard([
    ["name",        "정상 이름"],
    ["description", "짧은 설명"],
  ]);
  if (r === null) ok("모두 통과 → null 반환");
  else fail("모두 통과 → null 반환", null, r);
}

// 7-2. undefined/null 도 통과
{
  const r = apiTextLimitGuard([
    ["name",        undefined],
    ["description", null],
  ]);
  if (r === null) ok("undefined/null 통과 → null 반환");
  else fail("undefined/null 통과 → null 반환", null, r);
}

// 7-3. 한도 초과 시 NextResponse 반환 + 400
{
  const r = apiTextLimitGuard([
    ["name", "a".repeat(201)],
  ]);
  if (r === null) {
    fail("한도 초과 → NextResponse 반환", "NextResponse", null);
  } else {
    if (r.status === 400) ok("한도 초과 → 400 응답");
    else fail("한도 초과 → 400 응답", 400, r.status);

    // 응답 본문 — code/message/field/current/max 포함
    r.json().then((body) => {
      const checks = [
        body.code === "TEXT_TOO_LONG",
        typeof body.message === "string" && body.message.includes("이름"),
        body.field === "name",
        body.current === 201,
        body.max === 200,
      ];
      if (checks.every(Boolean)) ok(`응답 본문 정합 — ${JSON.stringify(body)}`);
      else fail("응답 본문 정합", "code/message/field/current/max", body);

      // 결과 출력 (json 이 비동기라 마지막에 반영)
      finalReport();
    }).catch((e) => {
      fail("응답 json 파싱", "성공", String(e));
      finalReport();
    });
  }
}

// ── 결과 출력 ────────────────────────────────────────────────────────────────
// 7번 블록의 응답 본문 검사가 비동기라 finalReport 호출 시점을 미룬다.

function finalReport() {
  console.log("\n" + "=".repeat(80));
  console.log(`결과: ${passed} passed, ${failed} failed / 총 ${passed + failed}`);
  if (failed > 0) {
    console.log("\n실패 항목:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("✅  모두 통과");
  process.exit(0);
}
