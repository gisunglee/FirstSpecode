/**
 * POST /api/admin/billing/subscriptions/[id]/retry — 즉시 재결제 (SUPER_ADMIN)
 *
 * PAST_DUE 구독에 대해 배치의 3일 간격을 기다리지 않고 지금 청구한다 ("카드 고쳤어요" 민원).
 * 감사는 서비스가 PG 호출 전 "시도" 행을 남기고 결과로 갱신한다 (실패한 시도도 기록).
 * Body: { reason: string }
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { adminRetryCharge } from "@/lib/billing/admin-actions";
import { toBillingErrorResponse } from "@/lib/billing/errors";

type RouteParams = { params: Promise<{ id: string }> };
const bodySchema = z.object({ reason: z.string().trim().min(1, "사유를 입력해 주세요.").max(500) });

export async function POST(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;
  const { id } = await params;
  const parsed = await parseJsonBody(request, bodySchema);
  if (parsed instanceof Response) return parsed;

  try {
    return apiSuccess(await adminRetryCharge(id, gate, parsed.data.reason));
  } catch (err) {
    const known = toBillingErrorResponse(err);
    if (known) return known;
    console.error(`[POST /api/admin/billing/subscriptions/${id}/retry] 오류:`, err);
    return apiError("BILLING_ERROR", "재결제 처리 중 오류가 발생했습니다.", 500);
  }
}
