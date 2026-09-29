/**
 * POST /api/billing/webhook/[provider] — PG 웹훅 수신 (인증 없음, 게이트웨이가 검증)
 *
 * 역할:
 *   - 게이트웨이(parseWebhook)가 서명·형식을 검증(토스는 결제 조회로 대조)해 PgEvent 로 바꾼다. 실패하면 400
 *   - (provider, pg_event_id) UNIQUE 로 중복 수신을 멱등 처리 — 이미 있으면 200 으로 조용히 끝
 *   - 원문을 tb_bl_pg_event 에 RECEIVED 로 남긴 뒤 종류별 처리(webhook.ts) 결과를 같은 행에 적는다
 *
 * 처리 정책은 src/lib/billing/webhook.ts 상단 참조. 처리 오류도 200 이다 — 행이 FAILED 로 남아 있고,
 * 4xx/5xx 를 돌려주면 토스가 최대 7회(3일 19시간) 재전송해 같은 오류만 반복한다.
 *
 * 남용 방어: 토스 빌링 웹훅에는 서명이 없어 IP 단위 rate limit 을 둔다(토스 재전송 간격은 분 단위라 넉넉하다).
 * 토스 등록 URL: https://www.specode.co.kr/api/billing/webhook/toss
 */

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { checkRateLimit } from "@/lib/rateLimit";
import { getPaymentGatewayFor, isPgProviderCode } from "@/lib/billing/gateway";
import { PG_EVENT_STATUS } from "@/lib/billing/constants";
import { processPgEvent } from "@/lib/billing/webhook";

type RouteParams = { params: Promise<{ provider: string }> };

/** IP 당 10분에 300건 — 토스 재전송(1·4·16분…)과 정상 트래픽을 넉넉히 덮으면서 무한 난사만 막는다 */
const WEBHOOK_RATE_LIMIT = { limit: 300, windowSec: 600 } as const;

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { provider } = await params;
  const code = provider.toUpperCase();
  if (!isPgProviderCode(code)) {
    return apiError("NOT_FOUND", "알 수 없는 결제 프로바이더입니다.", 404);
  }

  // 현재 활성 게이트웨이와 다른 프로바이더의 웹훅은 받지 않는다 (설정 실수·오발송 차단)
  const gw = getPaymentGatewayFor(code);
  if (!gw) {
    return apiError("NOT_FOUND", "현재 사용하지 않는 결제 프로바이더입니다.", 404);
  }

  const rl = await checkRateLimit({ key: `PG_WEBHOOK_IP:${clientIp(request)}`, ...WEBHOOK_RATE_LIMIT });
  if (!rl.ok) {
    return apiError("RATE_LIMITED", "요청이 너무 많습니다.", 429, { retryAfter: rl.retryAfter }, { "Retry-After": String(rl.retryAfter) });
  }

  let event;
  try {
    event = await gw.parseWebhook(request);
  } catch (err) {
    console.error(`[POST /api/billing/webhook/${code}] 파싱 오류:`, err);
    event = null;
  }
  if (!event) {
    return apiError("INVALID_WEBHOOK", "서명 또는 형식이 올바르지 않은 웹훅입니다.", 400);
  }

  // ① 원문 기록 — UNIQUE 충돌이면 재전송이므로 처리하지 않고 200
  let eventId: string;
  try {
    const row = await prisma.tbBlPgEvent.create({
      data: {
        pg_provdr_code:  code,
        pg_event_id:     event.providerEventId,
        event_ty_code:   event.eventType.slice(0, 60),
        payload:         event.payload as Prisma.InputJsonValue,
        prcs_sttus_code: PG_EVENT_STATUS.RECEIVED,
      },
      select: { event_id: true },
    });
    eventId = row.event_id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return apiSuccess({ received: true, duplicate: true });
    }
    console.error(`[POST /api/billing/webhook/${code}] 저장 오류:`, err);
    return apiError("DB_ERROR", "웹훅 저장에 실패했습니다.", 500);
  }

  // ② 종류별 처리 → 결과를 같은 행에
  const outcome = await processPgEvent(code, event);
  await prisma.tbBlPgEvent.update({
    where: { event_id: eventId },
    data:  { prcs_sttus_code: outcome.status, prcs_dt: new Date(), prcs_rsn_cn: outcome.reason },
  });
  return apiSuccess({ received: true, duplicate: false, status: outcome.status });
}
