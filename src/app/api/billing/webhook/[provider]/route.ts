/**
 * POST /api/billing/webhook/[provider] — PG 웹훅 수신 (인증 없음, 게이트웨이가 서명 검증)
 *
 * 역할:
 *   - 게이트웨이(parseWebhook)가 서명·형식을 검증해 PgEvent 로 바꾼다. 실패하면 400
 *   - (provider, pg_event_id) UNIQUE 로 중복 수신을 멱등 처리 — 이미 있으면 200 으로 조용히 끝
 *   - 원문을 tb_bl_pg_event 에 남긴다
 *
 * 처리 정책 (v1):
 *   빌링 청구는 우리가 동기 API 로 직접 하고 결과를 바로 반영하므로, 웹훅은 대조·감사용 기록이다.
 *   상태를 바꾸는 이벤트 처리는 토스 어댑터를 붙일 때 이벤트 종류별로 추가한다. 지금은 전부
 *   RECEIVED → IGNORED("v1 기록만") 로 마킹한다.
 *
 * 응답은 항상 빠르게 2xx — PG 는 2xx 가 아니면 재전송한다.
 */

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { getPaymentGatewayFor, isPgProviderCode } from "@/lib/billing/gateway";
import { PG_EVENT_STATUS } from "@/lib/billing/constants";

type RouteParams = { params: Promise<{ provider: string }> };

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

  try {
    await prisma.tbBlPgEvent.create({
      data: {
        pg_provdr_code:  code,
        pg_event_id:     event.providerEventId,
        event_ty_code:   event.eventType.slice(0, 60),
        payload:         event.payload as Prisma.InputJsonValue,
        prcs_sttus_code: PG_EVENT_STATUS.IGNORED,
        prcs_dt:         new Date(),
        prcs_rsn_cn:     "v1: 청구는 동기 API 로 반영 — 웹훅은 기록만",
      },
    });
    return apiSuccess({ received: true, duplicate: false });
  } catch (err) {
    // UNIQUE(pg_provdr_code, pg_event_id) 충돌 = 재전송 → 이미 처리했으니 200
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return apiSuccess({ received: true, duplicate: true });
    }
    console.error(`[POST /api/billing/webhook/${code}] 저장 오류:`, err);
    return apiError("DB_ERROR", "웹훅 저장에 실패했습니다.", 500);
  }
}
