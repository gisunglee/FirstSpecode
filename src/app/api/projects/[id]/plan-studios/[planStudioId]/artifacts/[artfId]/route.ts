/**
 * GET    /api/projects/[id]/plan-studios/[planStudioId]/artifacts/[artfId] — 산출물 상세 (FID-PS-05)
 * PUT    /api/projects/[id]/plan-studios/[planStudioId]/artifacts/[artfId] — 산출물 수정 (FID-PS-08 UPDATE)
 * DELETE /api/projects/[id]/plan-studios/[planStudioId]/artifacts/[artfId] — 산출물 삭제 (FID-PS-06)
 *
 * 역할:
 *   - GET: 산출물 본체 + 컨텍스트(라벨 JOIN) 조회
 *   - PUT: 본체 UPDATE + 컨텍스트 동기화 (DELETE → INSERT)
 *   - DELETE: CASCADE (ctxt 자동 삭제)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; planStudioId: string; artfId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, planStudioId, artfId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    const artf = await prisma.tbDsPlanStudioArtf.findUnique({
      where: { artf_id: artfId },
      include: { contexts: { orderBy: { sort_ordr: "asc" } } },
    });
    if (!artf || artf.plan_studio_id !== planStudioId) {
      return apiError("NOT_FOUND", "산출물을 찾을 수 없습니다.", 404);
    }

    // 컨텍스트 라벨 JOIN
    const reqIds = artf.contexts.filter((c) => c.ctxt_ty_code === "REQ").map((c) => c.ref_id);
    const artfIds = artf.contexts.filter((c) => c.ctxt_ty_code === "ARTF").map((c) => c.ref_id);

    const [reqs, refArtfs] = await Promise.all([
      reqIds.length
        ? prisma.tbRqRequirement.findMany({
            where: { req_id: { in: reqIds } },
            select: { req_id: true, req_display_id: true, req_nm: true },
          })
        : [],
      artfIds.length
        ? prisma.tbDsPlanStudioArtf.findMany({
            where: { artf_id: { in: artfIds } },
            include: { planStudio: { select: { plan_studio_display_id: true } } },
          })
        : [],
    ]);

    const reqMap = new Map(reqs.map((r) => [r.req_id, `${r.req_display_id} ${r.req_nm}`]));
    const artfMap = new Map(
      refArtfs.map((a) => [a.artf_id, `${a.planStudio.plan_studio_display_id} > ${a.artf_nm}`])
    );

    return apiSuccess({
      artfId: artf.artf_id,
      planStudioId: artf.plan_studio_id,
      artfNm: artf.artf_nm,
      artfDivCode: artf.artf_div_code,
      artfFmtCode: artf.artf_fmt_code,
      artfIdeaCn: artf.artf_idea_cn,
      comentCn: artf.coment_cn,
      artfCn: artf.artf_cn,
      goodDesignYn: artf.good_design_yn,
      aiTaskId: artf.ai_task_id,
      contexts: artf.contexts.map((c) => ({
        ctxtId: c.ctxt_id,
        ctxtTyCode: c.ctxt_ty_code,
        refId: c.ref_id,
        sortOrdr: c.sort_ordr,
        refLabel:
          c.ctxt_ty_code === "REQ"
            ? reqMap.get(c.ref_id) ?? c.ref_id
            : artfMap.get(c.ref_id) ?? c.ref_id,
      })),
      creatDt: artf.creat_dt,
      mdfcnDt: artf.mdfcn_dt,
    });
  } catch (err) {
    console.error(`[GET /api/artifacts/${artfId}]`, err);
    return apiError("DB_ERROR", "산출물 조회에 실패했습니다.", 500);
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, planStudioId, artfId } = await params;

  const gate = await requirePermission(request, projectId, "content.update");
  if (gate instanceof Response) return gate;

  let body: {
    artfNm?: string;
    artfDivCode?: string;
    artfFmtCode?: string;
    artfIdeaCn?: string;
    comentCn?: string;
    artfCn?: string;
    contexts?: Array<{ ctxtTyCode: string; refId: string; sortOrdr: number }>;
  };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  if (!body.artfNm?.trim()) return apiError("VALIDATION_ERROR", "기획명을 입력해 주세요.", 400);

  // 자기참조 검증
  if (body.contexts?.some((c) => c.ctxtTyCode === "ARTF" && c.refId === artfId)) {
    return apiError("VALIDATION_ERROR", "자기 자신을 컨텍스트로 추가할 수 없습니다.", 400);
  }

  try {
    const existing = await prisma.tbDsPlanStudioArtf.findUnique({ where: { artf_id: artfId } });
    if (!existing || existing.plan_studio_id !== planStudioId) {
      return apiError("NOT_FOUND", "산출물을 찾을 수 없습니다.", 404);
    }

    await prisma.$transaction(async (tx) => {
      // 본체 UPDATE
      await tx.tbDsPlanStudioArtf.update({
        where: { artf_id: artfId },
        data: {
          artf_nm: body.artfNm!.trim(),
          artf_div_code: body.artfDivCode ?? existing.artf_div_code,
          artf_fmt_code: body.artfFmtCode ?? existing.artf_fmt_code,
          artf_idea_cn: body.artfIdeaCn ?? existing.artf_idea_cn,
          coment_cn: body.comentCn ?? existing.coment_cn,
          artf_cn: body.artfCn ?? existing.artf_cn,
          mdfr_mber_id: gate.mberId,
          mdfcn_dt: new Date(),
        },
      });

      // 컨텍스트 동기화
      if (body.contexts) {
        await tx.tbDsPlanStudioCtxt.deleteMany({ where: { artf_id: artfId } });
        if (body.contexts.length > 0) {
          await tx.tbDsPlanStudioCtxt.createMany({
            data: body.contexts.map((c, i) => ({
              ctxt_id: crypto.randomUUID(),
              artf_id: artfId,
              ctxt_ty_code: c.ctxtTyCode,
              ref_id: c.refId,
              sort_ordr: c.sortOrdr ?? i,
              creat_mber_id: gate.mberId,
            })),
          });
        }
      }
    });

    return apiSuccess({ artfId });
  } catch (err) {
    console.error(`[PUT /api/artifacts/${artfId}]`, err);
    return apiError("DB_ERROR", "저장에 실패했습니다.", 500);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, planStudioId, artfId } = await params;

  const gate = await requirePermission(request, projectId, "content.delete");
  if (gate instanceof Response) return gate;

  try {
    const existing = await prisma.tbDsPlanStudioArtf.findUnique({ where: { artf_id: artfId } });
    if (!existing || existing.plan_studio_id !== planStudioId) {
      return apiError("NOT_FOUND", "산출물을 찾을 수 없습니다.", 404);
    }

    // CASCADE: ctxt 자동 삭제
    await prisma.tbDsPlanStudioArtf.delete({ where: { artf_id: artfId } });

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/artifacts/${artfId}]`, err);
    return apiError("DB_ERROR", "삭제에 실패했습니다.", 500);
  }
}
