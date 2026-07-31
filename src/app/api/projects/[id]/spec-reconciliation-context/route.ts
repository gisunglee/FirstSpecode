/**
 * GET /api/projects/[id]/spec-reconciliation-context
 *
 * MCP/웹에서 변경 경로와 UW를 기준으로 설계 후보를 조회한다.
 */

import { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { requirePermission } from "@/lib/requirePermission";
import { getReconciliationContext } from "@/lib/spec-reconciliation/context";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(
    request,
    projectId,
    "specReconcile.read",
  );
  if (gate instanceof Response) return gate;

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
    projectId,
    unitWorkRef,
    includeProjectIndex,
    paths,
  }));
}

