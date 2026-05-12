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

// ─── 상대 시간 포매터 ─────────────────────────────────────────────────────────
// "방금 전 / N분 전 / N시간 전 / N일 전 / YYYY-MM-DD"
// 외부 라이브러리 의존 없이 한국어로 표시. 30일 이상은 그냥 날짜로 폴백.
//
// 입력은 ISO 문자열 또는 Date 객체 모두 허용.
// 잘못된 입력이 들어오면 빈 문자열 반환 (UI 깨짐 방지).
export function formatRelativeKo(input: string | Date | null | undefined): string {
  if (!input) return "";
  const ms = typeof input === "string" ? Date.parse(input) : input.getTime();
  if (Number.isNaN(ms)) return "";

  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 0)   return "방금 전";  // 시계 오차로 미래 시각이 들어오는 경우
  if (sec < 60)  return "방금 전";
  const min = Math.floor(sec / 60);
  if (min < 60)  return `${min}분 전`;
  const hr  = Math.floor(min / 60);
  if (hr  < 24)  return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 30)  return `${day}일 전`;
  // 30일 넘어가면 날짜로 — 입력이 string 이면 ISO 앞 10자리, Date 면 toISOString 후 자르기
  const iso = typeof input === "string" ? input : input.toISOString();
  return iso.slice(0, 10);
}
