/** 검토자가 동기화 항목을 적용·거부·보류하는 API. */

import { NextRequest } from "next/server";
import { apiSuccess } from "@/lib/apiResponse";
import { requirePermission } from "@/lib/requirePermission";
import { specSyncApiError } from "@/lib/spec-sync/api";
import { syncDecisionSchema } from "@/lib/spec-sync/contracts";
import { decideSyncItem } from "@/lib/spec-sync/service";

type RouteParams = {
  params: Promise<{ id: string; runId: string; itemId: string }>;
};

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, runId, itemId } = await params;
  const reviewGate = await requirePermission(request, projectId, "specSync.review");
  if (reviewGate instanceof Response) return reviewGate;

  try {
    const decision = syncDecisionSchema.parse(await request.json());
    if (decision.decision === "APPLY") {
      const applyGate = await requirePermission(request, projectId, "specSync.apply");
      if (applyGate instanceof Response) return applyGate;
    }
    const result = await decideSyncItem({
      projectId,
      runId,
      itemId,
      memberId: reviewGate.mberId,
      rawDecision: decision,
    });
    return apiSuccess(result);
  } catch (error) {
    return specSyncApiError(error);
  }
}
