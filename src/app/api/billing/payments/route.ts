/**
 * GET /api/billing/payments — 내 결제 내역 (최신순, 최대 50건)
 *
 * 영수증 링크(receiptUrl)·실패 사유 포함. 첫 결제 실패처럼 구독 행이 없던 시점의 이력도
 * mber_id 기준으로 함께 나온다.
 */

import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireBillingActor } from "@/lib/billing/actor";
import { listPayments } from "@/lib/billing/subscription";

export async function GET(request: NextRequest) {
  const actor = await requireBillingActor(request);
  if (actor instanceof Response) return actor;

  try {
    const items = await listPayments(actor.mberId);
    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error("[GET /api/billing/payments] 오류:", err);
    return apiError("DB_ERROR", "결제 내역을 불러오지 못했습니다.", 500);
  }
}
