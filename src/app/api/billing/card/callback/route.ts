/**
 * POST /api/billing/card/callback — PG 카드 등록 성공 콜백 처리
 *
 * 왜 GET 리다이렉트가 아니라 POST 인가:
 *   PG 는 브라우저를 successUrl 로 되돌려 보내는데, 이 앱의 인증은 Authorization: Bearer 헤더라
 *   리다이렉트에 실리지 않는다. 그래서 successUrl 은 앱 화면(/settings/billing/callback)이고,
 *   그 화면이 PG 가 붙여 준 authKey·customerKey 와 URL 에 실어 둔 purpose·seatCnt 를 이 API 로 보낸다.
 *
 * Body: { authKey, customerKey, purpose: "start"|"change", seatCnt? }
 *   start  → 빌링키 발급 → 즉시 첫 결제 → 구독 ACTIVE (실패 시 402 BILLING_PAYMENT_FAILED)
 *   change → 빌링키 교체. PAST_DUE 였다면 곧바로 재결제 시도 결과(retry)도 함께 응답
 *
 * 보안: customerKey 는 회원별 고정값이라 로그인 사용자와 대조해 남의 authKey 를 막는다 (서비스 안).
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { requireBillingActor } from "@/lib/billing/actor";
import { getPaymentGateway } from "@/lib/billing/gateway";
import { checkMockBillingAccess } from "@/lib/billing/mock-access";
import { SEAT_INPUT_LIMITS } from "@/lib/billing/constants";
import { toBillingErrorResponse } from "@/lib/billing/errors";
import { completeCardRegistration } from "@/lib/billing/subscription";

const bodySchema = z.object({
  authKey:     z.string().min(1).max(500),
  customerKey: z.string().min(1).max(100),
  purpose:     z.enum(["start", "change"]),
  seatCnt:     z.number().int().min(SEAT_INPUT_LIMITS.min).max(SEAT_INPUT_LIMITS.max).optional(),
});

export async function POST(request: NextRequest) {
  const actor = await requireBillingActor(request);
  if (actor instanceof Response) return actor;

  // Mock PG 단계에서는 지정 계정만 구독 시작/카드 교체 가능 (mock-access.ts)
  const mockErr = checkMockBillingAccess(getPaymentGateway(), actor);
  if (mockErr) return mockErr;

  const parsed = await parseJsonBody(request, bodySchema);
  if (parsed instanceof Response) return parsed;

  try {
    const outcome = await completeCardRegistration(actor, parsed.data);
    return apiSuccess(outcome);
  } catch (err) {
    const known = toBillingErrorResponse(err);
    if (known) return known;
    console.error("[POST /api/billing/card/callback] 오류:", err);
    return apiError("BILLING_ERROR", "카드 등록 처리 중 오류가 발생했습니다.", 500);
  }
}
