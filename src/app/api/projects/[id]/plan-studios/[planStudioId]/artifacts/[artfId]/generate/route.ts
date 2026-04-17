/**
 * POST /api/projects/[id]/plan-studios/[planStudioId]/artifacts/[artfId]/generate
 * AI 생성 (FID-PS-13) — 기존 artf에 대해 저장 + AI 호출 + 본문 업데이트
 *
 * 처리 순서:
 *   1. 폼 데이터 저장 (PUT 로직)
 *   2. 프롬프트 직조
 *   3. AI 태스크 INSERT (PENDING → PROCESSING)
 *   4. Claude API 호출
 *   5. artf_cn UPDATE + AI 태스크 COMPLETED
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { buildPrompt } from "@/lib/plan-studio/prompt-builder";
import { AI_TASK_REF_TY_ARTF } from "@/constants/planStudio";

type RouteParams = { params: Promise<{ id: string; planStudioId: string; artfId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const { id: projectId, planStudioId, artfId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  let body: {
    artfNm: string;
    artfDivCode: string;
    artfFmtCode: string;
    artfIdeaCn?: string;
    comentCn?: string;
    contexts?: Array<{ ctxtTyCode: string; refId: string; sortOrdr: number }>;
  };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  if (!body.artfNm?.trim()) return apiError("VALIDATION_ERROR", "기획명을 입력해 주세요.", 400);

  // 컨텍스트 0건 + idea 공백 → 최소 입력 필요
  if ((!body.contexts || body.contexts.length === 0) && !body.artfIdeaCn?.trim()) {
    return apiError("VALIDATION_ERROR", "컨텍스트 또는 상세 아이디어를 입력해 주세요.", 400);
  }

  // 자기참조 체크
  if (body.contexts?.some((c) => c.ctxtTyCode === "ARTF" && c.refId === artfId)) {
    return apiError("VALIDATION_ERROR", "자기 자신을 컨텍스트로 추가할 수 없습니다.", 400);
  }

  try {
    // 존재 확인
    const existing = await prisma.tbDsPlanStudioArtf.findUnique({ where: { artf_id: artfId } });
    if (!existing || existing.plan_studio_id !== planStudioId) {
      return apiError("NOT_FOUND", "산출물을 찾을 수 없습니다. 삭제되었을 수 있습니다.", 404);
    }

    // [1단계] 저장
    await prisma.$transaction(async (tx) => {
      await tx.tbDsPlanStudioArtf.update({
        where: { artf_id: artfId },
        data: {
          artf_nm: body.artfNm.trim(),
          artf_div_code: body.artfDivCode,
          artf_fmt_code: body.artfFmtCode,
          artf_idea_cn: body.artfIdeaCn ?? null,
          coment_cn: body.comentCn ?? null,
          mdfr_mber_id: auth.mberId,
          mdfcn_dt: new Date(),
        },
      });
      await tx.tbDsPlanStudioCtxt.deleteMany({ where: { artf_id: artfId } });
      if (body.contexts?.length) {
        await tx.tbDsPlanStudioCtxt.createMany({
          data: body.contexts.map((c, i) => ({
            ctxt_id: crypto.randomUUID(),
            artf_id: artfId,
            ctxt_ty_code: c.ctxtTyCode,
            ref_id: c.refId,
            sort_ordr: c.sortOrdr ?? i,
            creat_mber_id: auth.mberId,
          })),
        });
      }
    });

    // [2단계] 프롬프트 직조
    const prompt = await buildPrompt({
      artfId,
      artfNm: body.artfNm,
      artfDivCode: body.artfDivCode,
      artfFmtCode: body.artfFmtCode,
      artfIdeaCn: body.artfIdeaCn ?? "",
      comentCn: body.comentCn ?? "",
      contexts: body.contexts ?? [],
    });

    // [3단계] AI 태스크 INSERT (PENDING 상태로 등록 — 이후 CC 워커가 처리)
    const aiTaskId = crypto.randomUUID();
    await prisma.tbAiTask.create({
      data: {
        ai_task_id: aiTaskId,
        prjct_id: projectId,
        ref_ty_code: AI_TASK_REF_TY_ARTF,
        ref_id: artfId,
        task_ty_code: body.artfDivCode,
        req_cn: prompt,
        coment_cn: body.comentCn,
        task_sttus_code: "PENDING",
        req_snapshot_data: { artfNm: body.artfNm, artfDivCode: body.artfDivCode, artfFmtCode: body.artfFmtCode, contexts: body.contexts },
        req_mber_id: auth.mberId,
      },
    });

    return apiSuccess({ artfId, aiTaskId, taskSttusCode: "PENDING" });
  } catch (err) {
    console.error(`[POST /api/artifacts/${artfId}/generate]`, err);
    return apiError("DB_ERROR", "AI 생성 처리 중 오류가 발생했습니다.", 500);
  }
}
