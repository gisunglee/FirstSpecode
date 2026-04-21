/**
 * PUT /api/projects/[id]/plan-studios/[planStudioId]/artifacts/[artfId]/good-design
 * 좋은 설계 토글 (FID-PS-10) — Y/N 자유 토글 (unique 강제 없음)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; planStudioId: string; artfId: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, planStudioId, artfId } = await params;

  const gate = await requirePermission(request, projectId, "content.update");
  if (gate instanceof Response) return gate;

  let body: { goodDesignYn?: string };
  try { body = await request.json(); } catch { return apiError("VALIDATION_ERROR", "올바른 JSON이 아닙니다.", 400); }

  const yn = body.goodDesignYn;
  if (yn !== "Y" && yn !== "N") return apiError("VALIDATION_ERROR", "Y 또는 N을 입력해 주세요.", 400);

  try {
    const artf = await prisma.tbDsPlanStudioArtf.findUnique({ where: { artf_id: artfId } });
    if (!artf || artf.plan_studio_id !== planStudioId) return apiError("NOT_FOUND", "산출물을 찾을 수 없습니다.", 404);

    await prisma.tbDsPlanStudioArtf.update({
      where: { artf_id: artfId },
      data: { good_design_yn: yn, mdfr_mber_id: gate.mberId, mdfcn_dt: new Date() },
    });

    return apiSuccess({ artfId, goodDesignYn: yn });
  } catch (err) {
    console.error("[PUT /api/artifacts/good-design]", err);
    return apiError("DB_ERROR", "좋은 설계 표시 변경에 실패했습니다.", 500);
  }
}
