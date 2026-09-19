/**
 * billing/pricing — 금액·날짜 계산 (순수 함수, DB 없음)
 *
 * 역할:
 *   - 월 청구액 = 좌석 수 × 좌석 단가 (플랜 기본료 없음 — 정책 §1-4)
 *   - 좌석 추가 일할 = 단가 × 추가 좌석 × 남은 일 ÷ 주기 일 (원 단위 반올림)
 *   - 다음 결제일 = 매월 같은 날(KST). 그 달에 없는 날이면 말일
 *
 * 시간대:
 *   서버(Vercel)는 UTC 로 돈다. "매월 같은 날"은 사용자가 보는 한국 날짜 기준이어야 하므로
 *   월 연산은 KST 로 변환한 뒤 수행하고 다시 UTC Date 로 돌려준다. 시각(시·분·초)은 유지한다.
 *
 * 테스트: scripts/billing-flow-db-smoke.ts 에서 경계값(31일 시작, 2월 등) 확인
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// ─── 금액 ────────────────────────────────────────────────────────────────────

/** 월 청구액 — 좌석 × 단가 */
export function monthlyAmount(seatCnt: number, unitPrice: number): number {
  return seatCnt * unitPrice;
}

/** 두 시각 사이의 일수 — 주기 일수 계산용 (반올림, 최소 1) */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS));
}

/** 남은 일수 — 오늘 일부라도 남았으면 1일로 센다 (올림). 주기가 끝났으면 0 */
export function remainingDays(now: Date, periodEnd: Date): number {
  const ms = periodEnd.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS);
}

export type ProrationInput = {
  unitPrice:   number;
  addSeats:    number;
  now:         Date;
  periodStart: Date;
  periodEnd:   Date;
};

export type ProrationResult = {
  amount:        number;
  periodDays:    number;
  remainingDays: number;
};

/**
 * 좌석 추가 일할 금액.
 *   일할 = 단가 × 추가 좌석 × 남은 일 ÷ 주기 일, 원 단위 반올림.
 *   남은 일은 주기 일을 넘지 않는다(주기 시작 직후 추가해도 한 달치 초과 청구 없음).
 */
export function prorationForAddedSeats(input: ProrationInput): ProrationResult {
  const periodDays = daysBetween(input.periodStart, input.periodEnd);
  const remaining  = Math.min(periodDays, remainingDays(input.now, input.periodEnd));
  const amount     = Math.round((input.unitPrice * input.addSeats * remaining) / periodDays);
  return { amount, periodDays, remainingDays: remaining };
}

// ─── 날짜 (KST) ──────────────────────────────────────────────────────────────

/** UTC Date → KST 벽시계 성분 */
function toKstParts(date: Date) {
  const k = new Date(date.getTime() + KST_OFFSET_MS);
  return {
    year:   k.getUTCFullYear(),
    month:  k.getUTCMonth(),      // 0-based
    day:    k.getUTCDate(),
    hour:   k.getUTCHours(),
    minute: k.getUTCMinutes(),
    second: k.getUTCSeconds(),
    ms:     k.getUTCMilliseconds(),
  };
}

/** 해당 연·월(0-based)의 일수 */
function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** KST 기준 일(day-of-month) — 결제일 기준(anchor) 산출용 */
export function kstDayOfMonth(date: Date): number {
  return toKstParts(date).day;
}

/**
 * KST 기준으로 n개월 뒤 같은 날. 그 달에 없는 날(29~31)은 말일로 맞춘다.
 *   anchorDay — 원래 결제일(예: 31). 지정하지 않으면 date 의 KST 일자를 쓴다.
 *   예) 1/31 시작, anchor 31 → 2/28 → 3/31 (anchor 를 넘기면 드리프트 없음)
 */
export function addMonthsKst(date: Date, months: number, anchorDay?: number): Date {
  const p = toKstParts(date);
  const totalMonth = p.month + months;
  const year   = p.year + Math.floor(totalMonth / 12);
  const month0 = ((totalMonth % 12) + 12) % 12;
  const day    = Math.min(anchorDay ?? p.day, daysInMonth(year, month0));
  const kstUtcMs = Date.UTC(year, month0, day, p.hour, p.minute, p.second, p.ms);
  return new Date(kstUtcMs - KST_OFFSET_MS);
}

/** 다음 주기 종료(= 다음 결제 시각) — 시작 시각 + 1개월(KST, 결제일 기준 유지) */
export function nextPeriodEnd(periodStart: Date, anchorDay: number): Date {
  return addMonthsKst(periodStart, 1, anchorDay);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** KST 날짜 문자열 "YYYY-MM-DD" — 메일·화면 표기 */
export function formatKstDate(date: Date): string {
  const p = toKstParts(date);
  const mm = String(p.month + 1).padStart(2, "0");
  const dd = String(p.day).padStart(2, "0");
  return `${p.year}-${mm}-${dd}`;
}

/** 원화 표기 "9,900원" */
export function formatWon(amount: number): string {
  return `${amount.toLocaleString("ko-KR")}원`;
}
