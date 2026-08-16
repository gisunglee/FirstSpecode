/** 로컬 Worker가 검증한 동기화 분석 결과를 제출하는 API. */

import { NextRequest } from "next/server";
import { requireWorkerAuth } from "@/app/api/worker/_lib/auth";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { specSyncApiError } from "@/lib/spec-sync/api";
import { submitSyncResult } from "@/lib/spec-sync/service";

type RouteParams = { params: Promise<{ runId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireWorkerAuth(request);
  if (auth instanceof Response) return auth;
  if (auth.role === "VIEWER") {
    return apiError(
      "FORBIDDEN_ROLE",
      "동기화 결과 제출은 프로젝트 MEMBER 이상만 할 수 있습니다.",
      403,
    );
  }

  try {
    const { runId } = await params;
    const result = await submitSyncResult({
      projectId: auth.prjctId,
      runId,
      memberId: auth.mberId,
      rawResult: await request.json(),
    });
    return apiSuccess(result);
  } catch (error) {
    return specSyncApiError(error);
  }
}
