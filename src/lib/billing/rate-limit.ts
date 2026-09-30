/**
 * billing/rate-limit — 결제 라우트의 회원 단위 속도 제한 (라이브 전 필수 ⑧, 2026-09-30)
 *
 * 왜: 카드 등록 시작·콜백은 요청마다 PG API(빌링키 발급 등)를 부른다. 로그인만 하면 누구나 부를 수 있는
 *     경로라 반복 호출로 PG 호출량·authKey 발급을 낭비시킬 수 있다. 정상 사용자는 10분에 몇 번이면 충분하다.
 * 어떻게: src/lib/rateLimit.ts 의 DB 고정 윈도우 카운터를 회원 ID 키로 쓴다(인증 라우트와 같은 방식).
 */

import { apiError } from "@/lib/apiResponse";
import { checkRateLimit } from "@/lib/rateLimit";

/** 카드 등록 시작·변경·콜백 합산 — 10분에 10회 */
const CARD_REGISTRATION_LIMIT = { limit: 10, windowSec: 600 } as const;

/** 허용이면 null, 초과면 429 Response */
export async function limitCardRegistration(mberId: string): Promise<Response | null> {
  const r = await checkRateLimit({ key: `BILLING_CARD_REG:${mberId}`, ...CARD_REGISTRATION_LIMIT });
  if (r.ok) return null;
  return apiError(
    "RATE_LIMITED",
    "카드 등록 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
    429,
    { retryAfter: r.retryAfter },
    { "Retry-After": String(r.retryAfter) },
  );
}
