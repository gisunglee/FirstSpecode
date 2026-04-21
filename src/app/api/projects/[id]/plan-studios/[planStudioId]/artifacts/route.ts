/**
 * POST /api/projects/[id]/plan-studios/[planStudioId]/artifacts — 산출물 신규 생성 (FID-PS-08 INSERT)
 *
 * 역할:
 *   - 기획실 내 새 산출물(artf) 생성
 *   - 기획명, 구분, 형식, 아이디어, 지시사항, 컨텍스트 포함
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; planStudioId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, planStudioId } = await params;

  const gate = await requirePermission(request, projectId, "content.create");
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

  // 기획실 소속 확인
  const studio = await prisma.tbDsPlanStudio.findUnique({ where: { plan_studio_id: planStudioId } });
  if (!studio || studio.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "기획실을 찾을 수 없습니다.", 404);
  }

  try {
    const artfId = crypto.randomUUID();

    await prisma.$transaction(async (tx) => {
      // 산출물 INSERT
      await tx.tbDsPlanStudioArtf.create({
        data: {
          artf_id: artfId,
          plan_studio_id: planStudioId,
          artf_nm: body.artfNm!.trim(),
          artf_div_code: body.artfDivCode ?? "IA",
          artf_fmt_code: body.artfFmtCode ?? "MD",
          artf_idea_cn: body.artfIdeaCn ?? null,
          coment_cn: body.comentCn ?? null,
          artf_cn: body.artfCn ?? null,
          good_design_yn: "N",
          creat_mber_id: gate.mberId,
        },
      });

      // 컨텍스트 INSERT
      if (body.contexts?.length) {
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
    });

    return apiSuccess({ artfId }, 201);
  } catch (err) {
    console.error("[POST /api/plan-studios/artifacts]", err);
    return apiError("DB_ERROR", "산출물 생성에 실패했습니다.", 500);
  }
}
