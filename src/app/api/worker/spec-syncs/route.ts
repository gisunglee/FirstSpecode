/** 로컬 Worker 인증으로 동기화 실행을 생성하는 API. */

import { NextRequest } from "next/server";
import { z } from "zod";
import { requireWorkerAuth } from "@/app/api/worker/_lib/auth";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { specSyncApiError } from "@/lib/spec-sync/api";
import { startSyncRun } from "@/lib/spec-sync/service";

const requestSchema = z.object({
  unitWorkRef: z.string().trim().min(1).max(50),
  mode: z.enum(["CHECK", "DEEP_SYNC"]).default("CHECK"),
  clientSubmissionKey: z.string().trim().min(1).max(100).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireWorkerAuth(request);
  if (auth instanceof Response) return auth;
  if (auth.role === "VIEWER") {
    return apiError(
      "FORBIDDEN_ROLE",
      "동기화 실행은 프로젝트 MEMBER 이상만 시작할 수 있습니다.",
      403,
    );
  }

  try {
    const body = requestSchema.parse(await request.json());
    const run = await startSyncRun({
      projectId: auth.prjctId,
      unitWorkRef: body.unitWorkRef,
      mode: body.mode,
      memberId: auth.mberId,
      clientSubmissionKey: body.clientSubmissionKey,
    });
    return apiSuccess(
      {
        ...run,
        projectId: auth.prjctId,
        projectName: auth.prjctNm ?? "(프로젝트명 미상)",
        requesterName: auth.mberNm ?? auth.email ?? "(사용자명 미상)",
      },
      201,
    );
  } catch (error) {
    return specSyncApiError(error);
  }
}
