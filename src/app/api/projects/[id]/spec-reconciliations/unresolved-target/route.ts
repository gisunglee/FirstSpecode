/**
 * 설계 상세 화면의 미반영 변경 배지용 단일 대상 집계.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { requirePermission } from "@/lib/requirePermission";

type RouteParams = { params: Promise<{ id: string }> };

const querySchema = z.object({
  targetType: z.enum(["UNIT_WORK", "SCREEN", "AREA", "FUNCTION"]),
  targetId: z.string().trim().min(1).max(36),
});

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(
    request,
    projectId,
    "specReconcile.read",
  );
  if (gate instanceof Response) return gate;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    targetType: url.searchParams.get("targetType"),
    targetId: url.searchParams.get("targetId"),
  });
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", "설계 대상 식별자가 올바르지 않습니다.", 400);
  }
  const items = await prisma.tbSpReconcileItem.findMany({
    where: {
      target_ref_ty_code: parsed.data.targetType,
      target_ref_id: parsed.data.targetId,
      item_sttus_code: {
        notIn: ["APPLIED", "NO_SPEC_CHANGE", "RESOLVED", "ROLLED_BACK"],
      },
      receipt: {
        prjct_id: projectId,
        receipt_sttus_code: {
          in: ["DRAFT", "NEEDS_REVIEW", "STALE_BASELINE"],
        },
      },
    },
    orderBy: { creat_dt: "desc" },
    select: {
      item_id: true,
      risk_code: true,
      receipt_id: true,
      item_sttus_code: true,
    },
  });
  return apiSuccess({
    count: items.length,
    maxRisk: maxRisk(items.map((item) => item.risk_code)),
    latestReceiptId: items[0]?.receipt_id ?? null,
    statuses: Array.from(new Set(items.map((item) => item.item_sttus_code))),
  });
}

function maxRisk(risks: string[]) {
  const order = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  return risks.reduce(
    (max, risk) =>
      order.indexOf(risk) > order.indexOf(max) ? risk : max,
    "LOW",
  );
}
