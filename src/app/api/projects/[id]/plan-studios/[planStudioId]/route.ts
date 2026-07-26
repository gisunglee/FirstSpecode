/**
 * GET    /api/projects/[id]/plan-studios/[planStudioId] — 기획실 상세 (FID-PS-04)
 * PUT    /api/projects/[id]/plan-studios/[planStudioId] — 기획실명 수정
 * DELETE /api/projects/[id]/plan-studios/[planStudioId] — 기획실 삭제 (FID-PS-02)
 *
 * 역할:
 *   - GET: 기획실 메타 + 산출물 목록 (artf별 최신 AI 상태 포함) 통합 조회
 *   - PUT: 기획실명(plan_studio_nm)만 수정 — 산출물 구조는 건드리지 않음
 *   - DELETE: CASCADE (artf → ctxt 자동 삭제)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { AI_TASK_REF_TY_ARTF } from "@/constants/planStudio";

type RouteParams = { params: Promise<{ id: string; planStudioId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, planStudioId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

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

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, planStudioId } = await params;

  const gate = await requirePermission(request, projectId, "content.update");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }
  const planStudioNm = (body as { planStudioNm?: unknown })?.planStudioNm;
  if (typeof planStudioNm !== "string" || !planStudioNm.trim()) {
    return apiError("VALIDATION_ERROR", "기획실명을 입력해 주세요.", 400);
  }

  try {
    const existing = await prisma.tbDsPlanStudio.findUnique({ where: { plan_studio_id: planStudioId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "기획실을 찾을 수 없습니다.", 404);
    }

    await prisma.tbDsPlanStudio.update({
      where: { plan_studio_id: planStudioId },
      data: { plan_studio_nm: planStudioNm.trim(), mdfcn_dt: new Date() },
    });

    return apiSuccess({ updated: true });
  } catch (err) {
    console.error(`[PUT /api/plan-studios/${planStudioId}]`, err);
    return apiError("DB_ERROR", "기획실명 수정에 실패했습니다.", 500);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, planStudioId } = await params;

  const gate = await requirePermission(request, projectId, "content.delete");
  if (gate instanceof Response) return gate;

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
