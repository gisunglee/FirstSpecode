/**
 * GET /api/worker/spec-reconciliations/context
 *
 * /sync-specode가 변경 파일과 선택한 UW를 4계층 스펙에 연결할 때 쓰는 읽기 API.
 */

import { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { getReconciliationContext } from "@/lib/spec-reconciliation/context";
import { requireWorkerAuth } from "../../_lib/auth";

export async function GET(request: NextRequest) {
  const auth = await requireWorkerAuth(request);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const unitWorkRef = url.searchParams.get("unitWork")?.trim() || null;
  const includeProjectIndex =
    url.searchParams.get("includeProjectIndex") === "true";
  const paths = url.searchParams
    .getAll("path")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!unitWorkRef && paths.length === 0 && !includeProjectIndex) {
    return apiError(
      "VALIDATION_ERROR",
      "unitWork, path 또는 includeProjectIndex=true 중 하나가 필요합니다.",
      400,
    );
  }
  return apiSuccess(await getReconciliationContext({
    projectId: auth.prjctId,
    unitWorkRef,
    includeProjectIndex,
    paths,
  }));
}

