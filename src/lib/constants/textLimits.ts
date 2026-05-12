/**
 * textLimits.ts — 장문 텍스트 필드 길이 제한 정책 (단일 진실)
 *
 * 역할:
 *   - 사용자 입력 장문 필드의 최대 글자수를 한 곳에서 관리
 *   - API/UI 양쪽에서 동일 상수 참조 → 정책 변경 시 이 파일만 수정
 *
 * 정책:
 *   - 한도는 "글자수(Unicode code point)" 기준 — 한국어 1글자 = 1
 *   - 맵에 **등록되지 않은 필드는 무제한** — AI 태스크 결과 등은 의도적으로 미등록
 *   - 한도 적용 전 기존 데이터 스캔 결과(2026-05-10): 50,000자 한도 적용 시 차단 0건
 *
 * 사용:
 *   API:  validateTextLimit("description", body.description); // throw on over-limit
 *   UI:   const { current, max, isOver } = useTextCount(value, "description");
 */

// ── 한도 정의 ────────────────────────────────────────────────────────────────
//
// 키 이름은 "도메인적 의미" 기준 — DB 컬럼명이 아님.
// 같은 의미의 필드는 도메인이 달라도 같은 키 사용 (예: 단위업무·화면·영역·기능 모두 "description")
//
// 50,000 자 ≈ A4 25장 분량. 일반 명세 문서로 충분.
// 100,000 자는 HTML 태그 오버헤드 고려 (요구사항 원문/현행화는 RichEditor → HTML 저장).

export const TEXT_LIMITS = {
  // ── 단문 ──
  name:           200,        // 항목명 (단위업무·화면·영역·기능·요구사항·과업)
  displayId:      50,         // 표시 ID (UW-XXXXX 형식)

  // ── 중문 ──
  comment:        2_000,      // 코멘트·짧은 메모

  // ── 장문 본문 (마크다운) ──
  description:    50_000,     // 단위업무·화면·영역·기능·과업 설명 본문
  detailSpec:     50_000,     // 요구사항 상세 명세
  analysisMemo:   50_000,     // 요구사항 분석 메모
  taskDefinition: 50_000,     // 과업 정의 / 상세 / 산출물 정보

  // ── 장문 본문 (HTML — RichEditor) ──
  htmlContent:   100_000,     // 요구사항 원문/현행화 (HTML 태그 오버헤드 고려)
} as const;

export type TextLimitField = keyof typeof TEXT_LIMITS;

// ── 한도 라벨 (에러 메시지·UI 카운터용) ───────────────────────────────────────
// 사용자에게 보일 한글 라벨 — 어떤 필드가 한도 초과인지 명확히 알려줘야 한다.

export const TEXT_LIMIT_LABEL: Record<TextLimitField, string> = {
  name:           "이름",
  displayId:      "표시 ID",
  comment:        "코멘트",
  description:    "설명",
  detailSpec:     "상세 명세",
  analysisMemo:   "분석 메모",
  taskDefinition: "과업 본문",
  htmlContent:    "본문",
};

// ── 검증 헬퍼 ────────────────────────────────────────────────────────────────

export class TextLimitError extends Error {
  field:   TextLimitField;
  current: number;
  max:     number;

  constructor(field: TextLimitField, current: number, max: number) {
    const label = TEXT_LIMIT_LABEL[field];
    super(`${label}은(는) ${max.toLocaleString()}자를 초과할 수 없습니다. (현재 ${current.toLocaleString()}자)`);
    this.name    = "TextLimitError";
    this.field   = field;
    this.current = current;
    this.max     = max;
  }
}

/**
 * API 라우트에서 사용 — 한도 초과 시 TextLimitError 던짐.
 * null/undefined/빈 문자열은 통과 (필수 검증은 별도 — 여기는 길이만 본다).
 *
 * 사용:
 *   validateTextLimit("description", body.description);
 *   validateTextLimit("detailSpec",  body.detailSpec);
 */
export function validateTextLimit(field: TextLimitField, value: unknown): void {
  if (value == null || value === "") return;
  if (typeof value !== "string") return; // 타입 검증은 호출자 책임

  const current = countChars(value);
  const max     = TEXT_LIMITS[field];

  if (current > max) {
    throw new TextLimitError(field, current, max);
  }
}

/**
 * 글자수 계산 — UTF-16 surrogate pair 안전 (이모지 1개 = 1글자로 집계).
 * `String.length` 는 UTF-16 코드 유닛 단위라 이모지가 2로 카운트되어 사용자 직관과 어긋남.
 */
export function countChars(s: string): number {
  // Array.from + Iterator → code point 단위 분해
  // (작은 데이터에선 문제 없음. 50,000자 정도는 1ms 내 처리)
  return Array.from(s).length;
}

// ── API Route 전용 가드 헬퍼 ─────────────────────────────────────────────────
//
// API 라우트에서 try/catch 보일러플레이트를 줄이기 위한 wrapper.
// 한 줄로 여러 필드를 검사하고, 한도 초과 시 NextResponse 를 반환한다.
//
// 사용:
//   const limitErr = apiTextLimitGuard([
//     ["name",        body.name],
//     ["description", body.description],
//   ]);
//   if (limitErr) return limitErr;

import { apiError } from "@/lib/apiResponse";
import type { NextResponse } from "next/server";

export function apiTextLimitGuard(
  checks: Array<[TextLimitField, unknown]>
): NextResponse | null {
  for (const [field, value] of checks) {
    try {
      validateTextLimit(field, value);
    } catch (e) {
      if (e instanceof TextLimitError) {
        return apiError("TEXT_TOO_LONG", e.message, 400, {
          field:   e.field,
          current: e.current,
          max:     e.max,
        });
      }
      throw e;
    }
  }
  return null;
}
