/** 실행 요청자가 로컬 분석 결과를 제출하는 웹/MCP API. */

import { NextRequest } from "next/server";
import { apiSuccess } from "@/lib/apiResponse";
import { requirePermission } from "@/lib/requirePermission";
import { specSyncApiError } from "@/lib/spec-sync/api";
import { submitSyncResult } from "@/lib/spec-sync/service";

type RouteParams = { params: Promise<{ id: string; runId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, runId } = await params;
  const gate = await requirePermission(request, projectId, "specSync.submit");
  if (gate instanceof Response) return gate;

  try {
    return apiSuccess(
      await submitSyncResult({
        projectId,
        runId,
        memberId: gate.mberId,
        rawResult: await request.json(),
      }),
    );
  } catch (error) {
    return specSyncApiError(error);
  }
}
