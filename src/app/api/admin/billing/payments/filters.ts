/**
 * 결제 이력 필터 파싱 — 목록·엑셀 내보내기가 같은 해석을 쓰도록 한 곳에.
 * from/to 는 YYYY-MM-DD, KST 하루 경계(to 는 그 날 포함 → 다음 날 00:00 미만).
 */

import { apiError } from "@/lib/apiResponse";
import type { PaymentFilters } from "@/lib/billing/admin";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function kstDayStart(date: string): Date {
  return new Date(`${date}T00:00:00+09:00`);
}

export function parsePaymentFilters(sp: URLSearchParams): PaymentFilters | Response {
  const fromRaw = sp.get("from")?.trim() ?? "";
  const toRaw   = sp.get("to")?.trim() ?? "";
  if ((fromRaw && !DATE_RE.test(fromRaw)) || (toRaw && !DATE_RE.test(toRaw))) {
    return apiError("VALIDATION_ERROR", "날짜는 YYYY-MM-DD 형식이어야 합니다.", 400);
  }
  const from = fromRaw ? kstDayStart(fromRaw) : undefined;
  const to   = toRaw   ? new Date(kstDayStart(toRaw).getTime() + 24 * 60 * 60 * 1000) : undefined;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    return apiError("VALIDATION_ERROR", "날짜가 올바르지 않습니다.", 400);
  }
  if (from && to && from >= to) {
    return apiError("VALIDATION_ERROR", "종료일은 시작일 이후여야 합니다.", 400);
  }
  return {
    from, to,
    status: sp.get("status")?.trim() || undefined,
    type:   sp.get("type")?.trim()   || undefined,
    search: sp.get("search")?.trim() || undefined,
  };
}
