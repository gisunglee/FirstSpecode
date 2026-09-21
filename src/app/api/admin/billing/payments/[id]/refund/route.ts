/**
 * POST /api/admin/billing/payments/[id]/refund — 환불 기록 (SUPER_ADMIN)
 *
 * 환불 실행은 PG 콘솔에서 수동(정책 §1-7). 실행 뒤 여기서 원장을 남긴다.
 * Body: { reason: "WITHDRAWAL" | "ADJUSTMENT", amount?: number, memo: string }
 *   WITHDRAWAL 청약철회 — 첫 결제·승인 7일 이내·유료 기능 미사용을 서버가 검사. 잔액 전액. 구독 즉시 종료.
 *   ADJUSTMENT 운영 보정 — amount 1원~잔액(생략 시 잔액 전액). 구독 유지.
 * 원 결제 행 잠금 + 감사 기록까지 한 트랜잭션.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { adminRecordRefund } from "@/lib/billing/admin-actions";
import { REFUND_REASON } from "@/lib/billing/constants";
import { toBillingErrorResponse } from "@/lib/billing/errors";

type RouteParams = { params: Promise<{ id: string }> };
const bodySchema = z.object({
  reason: z.enum([REFUND_REASON.WITHDRAWAL, REFUND_REASON.ADJUSTMENT]),
  amount: z.number().int().min(1).optional(),
  memo:   z.string().trim().min(1, "상세 사유를 입력해 주세요.").max(500),
});

export async function POST(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;
  const { id } = await params;
  const parsed = await parseJsonBody(request, bodySchema);
  if (parsed instanceof Response) return parsed;

  try {
    return apiSuccess(await adminRecordRefund(id, parsed.data, gate));
  } catch (err) {
    const known = toBillingErrorResponse(err);
    if (known) return known;
    console.error(`[POST /api/admin/billing/payments/${id}/refund] 오류:`, err);
    return apiError("BILLING_ERROR", "환불 기록 처리 중 오류가 발생했습니다.", 500);
  }
}
