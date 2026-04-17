/**
 * GET    /api/projects/[id]/plan-studios/[planStudioId] — 기획실 상세 (FID-PS-04)
 * DELETE /api/projects/[id]/plan-studios/[planStudioId] — 기획실 삭제 (FID-PS-02)
 *
 * 역할:
 *   - GET: 기획실 메타 + 산출물 목록 (artf별 최신 AI 상태 포함) 통합 조회
 *   - DELETE: CASCADE (artf → ctxt 자동 삭제)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { AI_TASK_REF_TY_ARTF } from "@/constants/planStudio";

type RouteParams = { params: Promise<{ id: string; planStudioId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const { id: projectId, planStudioId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const studio = await prisma.tbDsPlanStudio.findUnique({
      where: { plan_studio_id: planStudioId },
      include: { artifacts: { orderBy: { creat_dt: "desc" } } },
    });
    if (!studio || studio.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "기획실을 찾을 수 없습니다.", 404);
    }

    // 각 artf의 최신 AI 상태
    const artfIds = studio.artifacts.map((a) => a.artf_id);
    const aiTasks = artfIds.length
      ? await prisma.tbAiTask.findMany({
          where: { ref_ty_code: AI_TASK_REF_TY_ARTF, ref_id: { in: artfIds } },
          orderBy: { req_dt: "desc" },
          select: { ai_task_id: true, ref_id: true, task_sttus_code: true },
        })
      : [];
    // ref_id → { status, taskId } (첫 번째 = 최신)
    const aiMap = new Map<string, { status: string; taskId: string }>();
    for (const t of aiTasks) {
      if (!aiMap.has(t.ref_id)) aiMap.set(t.ref_id, { status: t.task_sttus_code, taskId: t.ai_task_id });
    }

    return apiSuccess({
      planStudio: {
        planStudioId: studio.plan_studio_id,
        planStudioDisplayId: studio.plan_studio_display_id,
        planStudioNm: studio.plan_studio_nm,
      },
      artifacts: studio.artifacts.map((a) => ({
        artfId: a.artf_id,
        artfNm: a.artf_nm,
        artfDivCode: a.artf_div_code,
        artfFmtCode: a.artf_fmt_code,
        goodDesignYn: a.good_design_yn,
        aiStatus: aiMap.get(a.artf_id)?.status ?? null,
        // aiTaskId: ai_task 테이블 우선, 없으면 artf.ai_task_id fallback
        aiTaskId: aiMap.get(a.artf_id)?.taskId ?? a.ai_task_id ?? null,
        mdfcnDt: a.mdfcn_dt,
        creatDt: a.creat_dt,
      })),
    });
  } catch (err) {
    console.error(`[GET /api/plan-studios/${planStudioId}]`, err);
    return apiError("DB_ERROR", "기획실 조회에 실패했습니다.", 500);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const { id: projectId, planStudioId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const existing = await prisma.tbDsPlanStudio.findUnique({ where: { plan_studio_id: planStudioId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "기획실을 찾을 수 없습니다.", 404);
    }

    // CASCADE: artf → ctxt 자동 삭제
    await prisma.tbDsPlanStudio.delete({ where: { plan_studio_id: planStudioId } });

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/plan-studios/${planStudioId}]`, err);
    return apiError("DB_ERROR", "삭제에 실패했습니다.", 500);
  }
}
