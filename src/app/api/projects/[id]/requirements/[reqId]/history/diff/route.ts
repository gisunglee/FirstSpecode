/**
 * GET /api/projects/[id]/requirements/[reqId]/history/diff — Diff 조회 (FID-00120)
 *
 * 쿼리 파라미터: ?v1={historyId1}&v2={historyId2}
 * - 두 버전의 orgnl_cn, curncy_cn을 반환
 * - 실제 Diff 하이라이트는 클라이언트 측에서 처리
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; reqId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, reqId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  const { searchParams } = new URL(request.url);
  const v1Id = searchParams.get("v1");
  const v2Id = searchParams.get("v2");

  if (!v1Id || !v2Id) {
    return apiError("VALIDATION_ERROR", "v1, v2 파라미터가 필요합니다.", 400);
  }
  if (v1Id === v2Id) {
    return apiError("VALIDATION_ERROR", "서로 다른 버전을 선택해 주세요.", 400);
  }

  try {
    const [h1, h2] = await Promise.all([
      prisma.tbRqRequirementHistory.findUnique({
        where:  { req_hist_id: v1Id },
        select: { req_hist_id: true, req_id: true, vrsn_no: true, orgnl_cn: true, curncy_cn: true },
      }),
      prisma.tbRqRequirementHistory.findUnique({
        where:  { req_hist_id: v2Id },
        select: { req_hist_id: true, req_id: true, vrsn_no: true, orgnl_cn: true, curncy_cn: true },
      }),
    ]);

    if (!h1 || h1.req_id !== reqId) return apiError("NOT_FOUND", "v1 이력을 찾을 수 없습니다.", 404);
    if (!h2 || h2.req_id !== reqId) return apiError("NOT_FOUND", "v2 이력을 찾을 수 없습니다.", 404);

    return apiSuccess({
      v1Content: {
        historyId: h1.req_hist_id,
        versionNo: h1.vrsn_no,
        orgnlCn:   h1.orgnl_cn   ?? "",
        curncyCn:  h1.curncy_cn  ?? "",
      },
      v2Content: {
        historyId: h2.req_hist_id,
        versionNo: h2.vrsn_no,
        orgnlCn:   h2.orgnl_cn   ?? "",
        curncyCn:  h2.curncy_cn  ?? "",
      },
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/requirements/${reqId}/history/diff] DB 오류:`, err);
    return apiError("DB_ERROR", "Diff 조회에 실패했습니다.", 500);
  }
}
