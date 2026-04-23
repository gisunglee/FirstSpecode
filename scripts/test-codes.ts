/**
 * test-codes.ts — 시스템 공통코드 라벨·색상 스냅샷 회귀 테스트
 *
 * 실행: npm run test:codes
 *
 * 목적:
 *   - `src/constants/codes.ts` 의 라벨/색상을 마이그레이션 과정에서
 *     실수로 변경하지 않도록 "기대 스냅샷"과 비교해 실패 시 즉시 감지
 *   - TypeScript 가 `Record<Type, X>` 로 키 누락은 잡지만, 값 문자열 변경은 못 잡는다
 *     → 이 테스트가 값 회귀 방지
 *
 * 라벨·색상을 **의도적으로 바꾸는** 경우에는 이 파일의 EXPECTED_* 를 함께 수정해야 한다.
 */

import {
  AI_TASK_STATUS_LABEL,
  AI_TASK_STATUS_BADGE,
  AI_TASK_STATUS_DOT,
  AI_TASK_TYPE_LABEL,
  AI_REF_TYPE_LABEL,
  PROMPT_TEMPLATE_TASK_TYPE_LABEL,
  PROMPT_TEMPLATE_REF_TYPE_LABEL,
  INVITATION_STATUS_LABEL,
  INVITATION_STATUS_COLOR,
} from "../src/constants/codes";

type Check = { label: string; actual: unknown; expected: unknown };

const checks: Check[] = [
  {
    label: "AI_TASK_STATUS_LABEL",
    actual: AI_TASK_STATUS_LABEL,
    expected: {
      PENDING:     "대기",
      IN_PROGRESS: "처리중",
      DONE:        "완료",
      APPLIED:     "반영됨",
      REJECTED:    "반려",
      FAILED:      "실패",
      TIMEOUT:     "시간초과",
    },
  },
  {
    label: "AI_TASK_STATUS_BADGE",
    actual: AI_TASK_STATUS_BADGE,
    expected: {
      PENDING:     { bg: "#f5f5f5", fg: "#666666" },
      IN_PROGRESS: { bg: "#e3f2fd", fg: "#1565c0" },
      DONE:        { bg: "#e8f5e9", fg: "#2e7d32" },
      APPLIED:     { bg: "#e8eaf6", fg: "#283593" },
      REJECTED:    { bg: "#fff3e0", fg: "#e65100" },
      FAILED:      { bg: "#ffebee", fg: "#c62828" },
      TIMEOUT:     { bg: "#fff3e0", fg: "#e65100" },
    },
  },
  {
    label: "AI_TASK_STATUS_DOT",
    actual: AI_TASK_STATUS_DOT,
    expected: {
      PENDING:     "#f57c00",
      IN_PROGRESS: "#1565c0",
      DONE:        "#2e7d32",
      APPLIED:     "#6a1b9a",
      REJECTED:    "#c62828",
      FAILED:      "#c62828",
      TIMEOUT:     "#757575",
    },
  },
  {
    label: "AI_TASK_TYPE_LABEL",
    actual: AI_TASK_TYPE_LABEL,
    expected: {
      INSPECT:   "명세 검토",
      DESIGN:    "설계",
      IMPLEMENT: "구현",
      MOCKUP:    "목업",
      IMPACT:    "영향도 분석",
      CUSTOM:    "자유 요청",
      PRE_IMPL:  "선 구현",
    },
  },
  {
    label: "AI_REF_TYPE_LABEL",
    actual: AI_REF_TYPE_LABEL,
    expected: {
      UNIT_WORK:        "단위업무",
      SCREEN:           "화면",
      AREA:             "영역",
      FUNCTION:         "기능",
      PLAN_STUDIO_ARTF: "기획실 산출물",
    },
  },
  {
    label: "PROMPT_TEMPLATE_TASK_TYPE_LABEL",
    actual: PROMPT_TEMPLATE_TASK_TYPE_LABEL,
    expected: {
      INSPECT:   "명세 검토",
      DESIGN:    "설계",
      IMPLEMENT: "구현",
      MOCKUP:    "목업",
      IMPACT:    "영향도 분석",
      CUSTOM:    "자유 요청",
      PRE_IMPL:  "선 구현",
      TEST:      "테스트",
    },
  },
  {
    label: "PROMPT_TEMPLATE_REF_TYPE_LABEL",
    actual: PROMPT_TEMPLATE_REF_TYPE_LABEL,
    expected: {
      UNIT_WORK: "단위업무",
      SCREEN:    "화면",
      AREA:      "영역",
      FUNCTION:  "기능",
    },
  },
  {
    label: "INVITATION_STATUS_LABEL",
    actual: INVITATION_STATUS_LABEL,
    expected: {
      PENDING:   "대기중",
      ACCEPTED:  "수락",
      EXPIRED:   "만료",
      CANCELLED: "취소",
    },
  },
  {
    label: "INVITATION_STATUS_COLOR",
    actual: INVITATION_STATUS_COLOR,
    expected: {
      PENDING:   "var(--color-brand)",
      ACCEPTED:  "var(--color-success, #22c55e)",
      EXPIRED:   "var(--color-text-tertiary)",
      CANCELLED: "var(--color-error)",
    },
  },
];

// ── 실행 ─────────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
const failures: string[] = [];

console.log("=".repeat(80));
console.log("공통코드 스냅샷 테스트 (codes.ts)");
console.log("=".repeat(80));

for (const c of checks) {
  const actualJson   = JSON.stringify(c.actual);
  const expectedJson = JSON.stringify(c.expected);
  if (actualJson === expectedJson) {
    console.log(`✅  ${c.label}`);
    passed++;
  } else {
    console.log(`❌  ${c.label}`);
    console.log(`      expected: ${expectedJson}`);
    console.log(`      actual:   ${actualJson}`);
    failures.push(c.label);
    failed++;
  }
}

console.log("=".repeat(80));
console.log(`결과: ${passed} passed, ${failed} failed / 총 ${checks.length}`);
if (failed > 0) {
  console.log("실패:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
