/**
 * effort — 공수(시간) 관련 공용 유틸
 *
 * 역할:
 *   - 공수(시간 단위 문자열)를 파싱하고, 하루 8시간 기준으로 일(日) 환산
 *   - 기능의 "구현 공수"(efrt_val), 화면의 "설계 공수"(design_efrt_val) 양쪽에서 공유 —
 *     각 상세 페이지의 참고 표시와 PM 대시보드(지연 공수 집계)에서 사용
 */

// 하루 8시간 기준 — 이 프로젝트의 "1일" 표준 근무시간
const HOURS_PER_DAY = 8;

// 공수 입력값(문자열) → 시간(숫자). 비어있거나 숫자가 아니거나 음수면 0.
export function parseEffortHours(raw: string | null | undefined): number {
  const hours = parseFloat(raw ?? "");
  return !raw?.trim() || isNaN(hours) || hours < 0 ? 0 : hours;
}

// 시간 → 일. 소수 첫째 자리까지.
export function hoursToDays(hours: number): number {
  return Math.round((hours / HOURS_PER_DAY) * 10) / 10;
}

// 공수(시간 문자열) → "1.5일" 같은 표시용 문자열. 0 이하면 빈 문자열(표시 안 함).
export function formatEffortDays(hoursStr: string): string {
  const hours = parseEffortHours(hoursStr);
  if (hours <= 0) return "";
  return `${hoursToDays(hours)}일`;
}
