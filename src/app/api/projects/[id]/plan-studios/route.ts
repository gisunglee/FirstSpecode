/**
 * GET  /api/projects/[id]/plan-studios — 기획실 목록 조회 (FID-PS-01)
 * POST /api/projects/[id]/plan-studios — 기획실 신규 생성 (FID-PS-03)
 *
 * 역할:
 *   - 프로젝트 내 기획실 목록 반환 (산출물 수 포함)
 *   - 신규 기획실 생성 (기획실명만 입력, PB-NNNNN 자동 채번)
 *
 * v2 구조:
 *   - 기획실 = 폴더(컨테이너), 산출물(artf) = 실제 작업 단위
 *   - 목록에서는 산출물 수(artfCount)를 COUNT로 제공
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { nextDisplayId } from "@/lib/plan-studio/display-id";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    // 기획실 목록 + 산출물 수 (include로 count 대체)
    const studios = await prisma.tbDsPlanStudio.findMany({
      where: { prjct_id: projectId },
      include: { artifacts: { select: { artf_id: true } } },
      orderBy: { creat_dt: "desc" },
    });

    return apiSuccess({
      items: studios.map((s) => ({
        planStudioId: s.plan_studio_id,
        planStudioDisplayId: s.plan_studio_display_id,
        planStudioNm: s.plan_studio_nm,
        artfCount: s.artifacts.length,
        mdfcnDt: s.mdfcn_dt,
        creatDt: s.creat_dt,
      })),
      totalCount: studios.length,
    });
  } catch (err) {
    console.error("[GET /api/plan-studios]", err);
    return apiError("DB_ERROR", "기획실 목록 조회에 실패했습니다.", 500);
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

  let body: { planStudioNm?: string };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const name = body.planStudioNm?.trim();
  if (!name) return apiError("VALIDATION_ERROR", "기획실명을 입력해 주세요.", 400);

  try {
    const displayId = await nextDisplayId(projectId);

    const created = await prisma.tbDsPlanStudio.create({
      data: {
        plan_studio_id: crypto.randomUUID(),
        prjct_id: projectId,
        plan_studio_display_id: displayId,
        plan_studio_nm: name,
        creat_mber_id: gate.mberId,
      },
    });

    return apiSuccess(
      { planStudioId: created.plan_studio_id, planStudioDisplayId: created.plan_studio_display_id },
      201
    );
  } catch (err) {
    console.error("[POST /api/plan-studios]", err);
    return apiError("DB_ERROR", "생성 중 오류가 발생했습니다.", 500);
  }
}
