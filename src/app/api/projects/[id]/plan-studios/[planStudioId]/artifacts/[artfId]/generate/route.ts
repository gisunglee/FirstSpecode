/**
 * POST /api/projects/[id]/plan-studios/[planStudioId]/artifacts/[artfId]/generate
 * AI 생성 (FID-PS-13) — 기존 artf 에 대해 저장 + AI 태스크 INSERT
 *
 * Body (둘 중 하나):
 *   - application/json   : { artfNm, artfDivCode, artfFmtCode, artfIdeaCn?, comentCn?, contexts? } ← MCP·외부 호출자
 *   - multipart/form-data : 동일 필드(텍스트) + contexts(JSON 문자열) + files[]                    ← 브라우저 FE
 *
 * 처리 순서:
 *   1. 폼 데이터 저장 (산출물 entity 갱신 + 컨텍스트 재생성)
 *      - tb_ds_plan_studio_artf.coment_cn 은 더 이상 저장하지 않는다.
 *        (코멘트는 일회성 — tb_ai_task.coment_cn 한 곳으로 통일)
 *   2. 프롬프트 직조
 *   3. AI 태스크 INSERT (PENDING)
 *   4. 첨부 이미지 저장 (multipart 인 경우만) — 실패 시 태스크 롤백
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { buildPrompt } from "@/lib/plan-studio/prompt-builder";
import { AI_TASK_REF_TY_ARTF } from "@/constants/planStudio";
import { parseAiRequest, saveAiTaskAttachments } from "@/lib/aiTaskAttach";

type RouteParams = { params: Promise<{ id: string; planStudioId: string; artfId: string }> };

type ContextItem = { ctxtTyCode: string; refId: string; sortOrdr?: number };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, planStudioId, artfId } = await params;

  // AI 생성 — 실질적 AI 요청이므로 ai.request (VIEWER 만 차단, 플랜 게이트 없음)
  const gate = await requirePermission(request, projectId, "ai.request");
  if (gate instanceof Response) return gate;

  // ── 본문 파싱 (JSON / multipart 모두 수용) ──────────────────────────────────
  let raw: Record<string, string>;
  let files: File[];
  let jsonBody: Record<string, unknown> | null;
  try {
    const parsed = await parseAiRequest(request);
    raw      = parsed.raw;
    files    = parsed.files;
    jsonBody = parsed.json;
  } catch {
    return apiError("VALIDATION_ERROR", "요청 본문을 파싱할 수 없습니다.", 400);
  }

  const artfNm      = (raw.artfNm      ?? "").trim();
  const artfDivCode = (raw.artfDivCode ?? "").trim();
  const artfFmtCode = (raw.artfFmtCode ?? "").trim();
  const artfIdeaCn  =  raw.artfIdeaCn  ?? "";
  const comentCn    = (raw.comentCn    ?? "").trim();

  // contexts — multipart 는 JSON 문자열, JSON 요청은 객체 배열
  let contexts: ContextItem[] = [];
  if (jsonBody && Array.isArray(jsonBody.contexts)) {
    contexts = jsonBody.contexts as ContextItem[];
  } else if (raw.contexts) {
    try {
      const parsed = JSON.parse(raw.contexts);
      if (Array.isArray(parsed)) contexts = parsed as ContextItem[];
    } catch {
      return apiError("VALIDATION_ERROR", "contexts JSON 형식이 올바르지 않습니다.", 400);
    }
  }

  // ── 입력 검증 ──────────────────────────────────────────────────────────────
  if (!artfNm)      return apiError("VALIDATION_ERROR", "기획명을 입력해 주세요.", 400);
  if (!artfDivCode) return apiError("VALIDATION_ERROR", "산출물 구분이 누락되었습니다.", 400);
  if (!artfFmtCode) return apiError("VALIDATION_ERROR", "출력 형식이 누락되었습니다.", 400);

  // 컨텍스트 0건 + idea 공백 → 최소 입력 필요
  if (contexts.length === 0 && !artfIdeaCn.trim()) {
    return apiError("VALIDATION_ERROR", "컨텍스트 또는 상세 아이디어를 입력해 주세요.", 400);
  }

  // 자기참조 체크
  if (contexts.some((c) => c.ctxtTyCode === "ARTF" && c.refId === artfId)) {
    return apiError("VALIDATION_ERROR", "자기 자신을 컨텍스트로 추가할 수 없습니다.", 400);
  }

  try {
    // 존재 확인
    const existing = await prisma.tbDsPlanStudioArtf.findUnique({ where: { artf_id: artfId } });
    if (!existing || existing.plan_studio_id !== planStudioId) {
      return apiError("NOT_FOUND", "산출물을 찾을 수 없습니다. 삭제되었을 수 있습니다.", 404);
    }

    // [1단계] 저장 — coment_cn 은 더 이상 entity 에 쓰지 않음 (일회성 → tb_ai_task 한 곳에)
    await prisma.$transaction(async (tx) => {
      await tx.tbDsPlanStudioArtf.update({
        where: { artf_id: artfId },
        data: {
          artf_nm:       artfNm,
          artf_div_code: artfDivCode,
          artf_fmt_code: artfFmtCode,
          artf_idea_cn:  artfIdeaCn || null,
          // coment_cn 의도적으로 갱신 안 함
          mdfr_mber_id:  gate.mberId,
          mdfcn_dt:      new Date(),
        },
      });
      await tx.tbDsPlanStudioCtxt.deleteMany({ where: { artf_id: artfId } });
      if (contexts.length) {
        await tx.tbDsPlanStudioCtxt.createMany({
          data: contexts.map((c, i) => ({
            ctxt_id:       crypto.randomUUID(),
            artf_id:       artfId,
            ctxt_ty_code:  c.ctxtTyCode,
            ref_id:        c.refId,
            sort_ordr:     c.sortOrdr ?? i,
            creat_mber_id: gate.mberId,
          })),
        });
      }
    });

    // [2단계] 프롬프트 직조 (DB 매칭된 시스템 프롬프트 + 요구사항/기획보드 직조)
    const prompt = await buildPrompt({
      projectId,
      artfId,
      artfNm,
      artfDivCode,
      artfFmtCode,
      artfIdeaCn,
      comentCn,
      contexts,
    });

    // [3단계] AI 태스크 INSERT (PENDING — 워커 처리 대기)
    const aiTaskId = crypto.randomUUID();
    await prisma.tbAiTask.create({
      data: {
        ai_task_id:        aiTaskId,
        prjct_id:          projectId,
        ref_ty_code:       AI_TASK_REF_TY_ARTF,
        ref_id:            artfId,
        // task_ty_code 에 산출물 구분(IA/JOURNEY/...) 을 그대로 저장 — 기획실 도메인 관행
        task_ty_code:      artfDivCode,
        req_cn:            prompt,
        coment_cn:         comentCn || null,
        task_sttus_code:   "PENDING",
        req_snapshot_data: { artfNm, artfDivCode, artfFmtCode, contexts },
        req_mber_id:       gate.mberId,
      },
    });

    // [4단계] 첨부 이미지 저장 — multipart 인 경우만. 실패 시 태스크 롤백.
    let attachmentCount = 0;
    if (files.length > 0) {
      try {
        attachmentCount = await saveAiTaskAttachments({
          projectId,
          taskId: aiTaskId,
          files,
        });
      } catch (attachErr) {
        await prisma.tbAiTask.delete({ where: { ai_task_id: aiTaskId } })
          .catch((e) => console.error("[Plan Studio AI] 태스크 롤백 실패:", e));
        const msg = attachErr instanceof Error ? attachErr.message : "첨부 저장 실패";
        return apiError("UPLOAD_ERROR", msg, 500);
      }
    }

    return apiSuccess({ artfId, aiTaskId, taskSttusCode: "PENDING", attachmentCount });
  } catch (err) {
    console.error(`[POST /api/artifacts/${artfId}/generate]`, err);
    return apiError("DB_ERROR", "AI 생성 처리 중 오류가 발생했습니다.", 500);
  }
}
