/** 로컬 Worker가 본인의 진행 중 동기화를 취소하는 API. */

import { NextRequest } from "next/server";
import { requireWorkerAuth } from "@/app/api/worker/_lib/auth";
import { apiSuccess } from "@/lib/apiResponse";
import { specSyncApiError } from "@/lib/spec-sync/api";
import { cancelSyncRun } from "@/lib/spec-sync/service";

type RouteParams = { params: Promise<{ runId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireWorkerAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { runId } = await params;
    return apiSuccess(
      await cancelSyncRun({
        projectId: auth.prjctId,
        runId,
        memberId: auth.mberId,
      }),
    );
  } catch (error) {
    return specSyncApiError(error);
  }
}
