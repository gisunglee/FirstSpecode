/**
 * POST /api/projects/[id]/unit-works/[unitWorkId]/ai — 단위업무 AI 태스크 요청
 *
 * Body: { taskType: "DESIGN" | "INSPECT", coment_cn? }
 *
 * 프롬프트 조립:
 *   DESIGN  → <시스템프롬프트> + <코멘트> + <점검 대상>(단위업무 설명만)
 *   INSPECT → <시스템프롬프트> + <전체 설계서>(단위업무 top-down 전체 tree) + <코멘트> + <점검 대상>(단위업무 설명)
 *
 * 프롬프트 탐색 기준:
 *   - task_ty_code: DESIGN | INSPECT (기능과 동일)
 *   - ref_ty_code 필터 없음 (넓게 검색)
 *   - default_yn='Y' 우선 → 프로젝트 전용 → 시스템 공통 → 최신 순
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { buildDesignContext } from "@/lib/buildDesignContext";

type RouteParams = { params: Promise<{ id: string; unitWorkId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, unitWorkId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { taskType, coment_cn } = body as { taskType?: string; coment_cn?: string };

  if (!taskType || !["DESIGN", "INSPECT"].includes(taskType)) {
    return apiError("VALIDATION_ERROR", "taskType은 DESIGN, INSPECT 중 하나여야 합니다.", 400);
  }

  try {
    const uw = await prisma.tbDsUnitWork.findUnique({ where: { unit_work_id: unitWorkId } });
    if (!uw || uw.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "단위업무를 찾을 수 없습니다.", 404);
    }

    const effectiveDesc = uw.unit_work_dc?.trim() ?? "";
    const commentPart   = coment_cn?.trim() ?? "";

    if (!effectiveDesc) {
      return apiError("VALIDATION_ERROR", "설명(description)을 먼저 작성해 주세요.", 400);
    }

    // ── 프롬프트 템플릿 조회 ─────────────────────────────────────────────────
    // ref_ty_code = "UNIT_WORK" 인 템플릿만 조회 (FUNCTION용 템플릿과 구분)
    const promptTmpl = await prisma.tbAiPromptTemplate.findFirst({
      where: {
        OR:           [{ prjct_id: projectId }, { prjct_id: null }],
        task_ty_code: taskType,
        ref_ty_code:  "UNIT_WORK",
        use_yn:       "Y",
      },
      orderBy: [
        { default_yn: "desc" },
        { prjct_id:   { sort: "desc", nulls: "last" } },
        { creat_dt:   "desc" },
      ],
    });

    const sysPrompt = promptTmpl?.sys_prompt_cn?.trim() ?? "";

    // ── 전체 설계서 컨텍스트 수집 (INSPECT만 — top-down 전체 tree) ──────────
    let designContextXml = "";
    if (taskType === "INSPECT") {
      const ctx = await buildDesignContext("UNIT_WORK", unitWorkId);
      designContextXml = ctx.xml;
    }

    // ── 프롬프트 조립 ────────────────────────────────────────────────────────
    // INSPECT: 전체설계서 자체가 점검 대상 (단위업무 전체 설계를 봐줘)
    // DESIGN:  단위업무 설명이 점검 대상 (이 설명 기반으로 설계해줘)
    const parts: string[] = [];

    if (sysPrompt) {
      parts.push(`<시스템프롬프트>\n${sysPrompt}\n</시스템프롬프트>`);
    }

    if (commentPart) {
      parts.push(`<코멘트>\n${commentPart}\n</코멘트>`);
    }

    if (taskType === "INSPECT" && designContextXml) {
      // 전체설계서가 곧 점검 대상
      parts.push(`<점검 대상>\n${designContextXml}\n</점검 대상>`);
    } else if (effectiveDesc) {
      parts.push(`<점검 대상>\n${effectiveDesc}\n</점검 대상>`);
    }

    const finalReqCn = parts.join("\n\n");

    // ── 사용 횟수 증가 ───────────────────────────────────────────────────────
    if (promptTmpl) {
      await prisma.tbAiPromptTemplate.update({
        where: { tmpl_id: promptTmpl.tmpl_id },
        data:  { use_cnt: { increment: 1 } },
      });
    }

    // ── AI 태스크 생성 ───────────────────────────────────────────────────────
    const task = await prisma.tbAiTask.create({
      data: {
        prjct_id:          projectId,
        ref_ty_code:       "UNIT_WORK",
        ref_id:            unitWorkId,
        task_ty_code:      taskType,
        coment_cn:         commentPart || null,
        req_cn:            finalReqCn,
        req_snapshot_data: {
          unitWorkId:    unitWorkId,
          unitWorkNm:    uw.unit_work_nm,
          description:   uw.unit_work_dc,
          promptTmplId:  promptTmpl?.tmpl_id ?? null,
          promptTmplNm:  promptTmpl?.tmpl_nm ?? null,
        },
        req_mber_id:       auth.mberId,
        task_sttus_code:   "PENDING",
        retry_cnt:         0,
      },
    });

    return apiSuccess({ aiTaskId: task.ai_task_id, status: "PENDING", taskType }, 202);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/unit-works/${unitWorkId}/ai] DB 오류:`, err);
    return apiError("DB_ERROR", "AI 요청 중 오류가 발생했습니다.", 500);
  }
}
