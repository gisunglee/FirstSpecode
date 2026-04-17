/**
 * GET /api/projects/[id]/baseline/[baselineId]/requirements — 기준선 요구사항 목록 (FID-00125)
 *
 * snapshot_data (JSONB) 를 파싱해 반환
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; baselineId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, baselineId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const baseline = await prisma.tbRqBaselineSnapshot.findUnique({
      where:  { basln_id: baselineId },
      select: { basln_id: true, prjct_id: true, basln_nm: true, coment_cn: true, cnfrm_dt: true, req_cnt: true, snapshot_data: true },
    });

    if (!baseline || baseline.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "기준선을 찾을 수 없습니다.", 404);
    }

    // snapshot_data 는 Prisma Json 타입 — 배열로 캐스팅
    const items = Array.isArray(baseline.snapshot_data) ? baseline.snapshot_data : [];

    return apiSuccess({
      baselineId:   baseline.basln_id,
      name:         baseline.basln_nm,
      comment:      baseline.coment_cn ?? "",
      confirmedAt:  baseline.cnfrm_dt.toISOString(),
      items,
      totalCount:   items.length,
    });
  } catch (err) {
    console.error(
      `[GET /api/projects/${projectId}/baseline/${baselineId}/requirements] DB 오류:`,
      err
    );
    return apiError("DB_ERROR", "기준선 요구사항 조회에 실패했습니다.", 500);
  }
}
