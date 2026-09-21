/**
 * POST /api/admin/billing/subscriptions/[id]/retry — 즉시 재결제 (SUPER_ADMIN)
 *
 * PAST_DUE 구독에 대해 배치의 3일 간격을 기다리지 않고 지금 청구한다 ("카드 고쳤어요" 민원).
 * 결과가 실패면 fail_cnt 가 올라가고 소진 시 강등까지 그대로 진행된다 — 배치와 같은 함수.
 * Body: { reason: string }  → 감사 BILLING_RETRY_CHARGE
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { logAdminAction } from "@/lib/audit";
import { adminRetryCharge } from "@/lib/billing/admin";
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
    const result = await adminRetryCharge(id);
    await logAdminAction({
      adminMberId: gate.mberId, actionType: "BILLING_RETRY_CHARGE", targetType: "SUBSCRIPTION", targetId: id,
      memo: `[즉시 재결제] ${result.ok ? `성공 ${result.amount.toLocaleString("ko-KR")}원` : result.skipped ? "다른 처리 진행 중(건너뜀)" : `실패 fail_cnt=${result.failCnt}${result.expired ? " → EXPIRED 강등" : ""}`} · ${parsed.data.reason}`,
      ipAddr: gate.ipAddr, userAgent: gate.userAgent,
    });
    return apiSuccess(result);
  } catch (err) {
    const known = toBillingErrorResponse(err);
    if (known) return known;
    console.error(`[POST /api/admin/billing/subscriptions/${id}/retry] 오류:`, err);
    return apiError("BILLING_ERROR", "재결제 처리 중 오류가 발생했습니다.", 500);
  }
}
