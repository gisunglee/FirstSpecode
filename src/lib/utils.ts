/**
 * utils — 공통 유틸리티 함수
 *
 * 역할:
 *   - 여러 곳에서 재사용되는 순수 함수 모음
 *   - 비즈니스 로직 없는 범용 헬퍼만 여기에 둘 것
 *
 * 원칙:
 *   - 함수 하나는 하나의 일만 한다
 *   - 부수효과(side effect) 없는 순수 함수로 작성
 */

// ─── 클래스명 합치기 ───────────────────────────────────────────────────────────
// Tailwind 클래스를 조건부로 합칠 때 사용
// 예: cn("px-4", isActive && "bg-blue-500")
export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

// ─── ID 파라미터 파싱 ──────────────────────────────────────────────────────────
// URL 파라미터의 id 문자열을 양의 정수로 변환
// 유효하지 않으면 null 반환 (API Route에서 400 처리용)
export function parsePositiveInt(value: string): number | null {
  const num = parseInt(value, 10);

  // NaN이거나 음수/0이면 유효하지 않은 ID
  if (isNaN(num) || num <= 0) return null;

  return num;
}

// ─── 날짜 포맷 ─────────────────────────────────────────────────────────────────
// Date 객체 또는 ISO 문자열을 "YYYY-MM-DD" 형식으로 변환
// 예: formatDate(new Date()) → "2025-03-24"
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toISOString().slice(0, 10);
}

// ─── 빈 값 체크 ───────────────────────────────────────────────────────────────
// null, undefined, 빈 문자열, 공백만 있는 문자열을 모두 "비어있음"으로 처리
export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  return false;
}
