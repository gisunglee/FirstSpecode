/**
 * POST /api/admin/billing/payments/[id]/refund — 환불 기록 (SUPER_ADMIN)
 *
 * 환불 실행은 PG 콘솔에서 수동(정책 §1-7). 실행 뒤 여기서 REFUND 이력을 남겨 결제 내역·정산과 대조가
 * 가능하게 한다. 원 결제는 REFUNDED 로 표시된다.
 * Body: { amount: 1~원 결제 금액, reason: string } → 감사 BILLING_REFUND_RECORD
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { logAdminAction } from "@/lib/audit";
import { adminRecordRefund } from "@/lib/billing/admin";
import { toBillingErrorResponse } from "@/lib/billing/errors";

type RouteParams = { params: Promise<{ id: string }> };
const bodySchema = z.object({
  amount: z.number().int().min(1),
  reason: z.string().trim().min(1, "사유를 입력해 주세요.").max(500),
});

export async function POST(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;
  const { id } = await params;
  const parsed = await parseJsonBody(request, bodySchema);
  if (parsed instanceof Response) return parsed;

  try {
    const result = await adminRecordRefund(id, parsed.data.amount, parsed.data.reason);
    await logAdminAction({
      adminMberId: gate.mberId, actionType: "BILLING_REFUND_RECORD", targetType: "PAYMENT", targetId: id,
      memo: `[환불 기록] ${parsed.data.amount.toLocaleString("ko-KR")}원 / 원 결제 ${result.original.amount.toLocaleString("ko-KR")}원 (${result.original.orderId}) · ${parsed.data.reason}`,
      ipAddr: gate.ipAddr, userAgent: gate.userAgent,
    });
    return apiSuccess(result);
  } catch (err) {
    const known = toBillingErrorResponse(err);
    if (known) return known;
    console.error(`[POST /api/admin/billing/payments/${id}/refund] 오류:`, err);
    return apiError("BILLING_ERROR", "환불 기록 처리 중 오류가 발생했습니다.", 500);
  }
}
