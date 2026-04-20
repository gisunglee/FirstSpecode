/**
 * POST /api/projects/[id]/functions/[functionId]/ai — AI 태스크 요청 (FID-00174, 00175)
 *
 * Body: { taskType: "INSPECT" | "IMPACT" | "DESIGN", coment_cn?, req_cn? }
 *
 * 프롬프트 조립 방식 (DESIGN · INSPECT · IMPACT 공통):
 *   1. task_ty_code 에 맞는 프롬프트 템플릿 조회 (default_yn='Y' 우선)
 *   2. <시스템프롬프트>내용</시스템프롬프트>
 *   3. <코멘트>내용</코멘트>  (코멘트 있을 때만)
 *   4. 설명 원문 (req_cn 또는 DB func_dc)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { buildDesignContext } from "@/lib/buildDesignContext";
import { expandTableScripts } from "@/lib/dbTableScript";

type RouteParams = { params: Promise<{ id: string; functionId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, functionId } = await params;

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

  const { taskType, comment, coment_cn, req_cn } = body as {
    taskType?:  string;
    comment?:   string;
    coment_cn?: string;
    req_cn?:    string;
  };

  if (!taskType || !["INSPECT", "IMPACT", "DESIGN"].includes(taskType)) {
    return apiError("VALIDATION_ERROR", "taskType은 INSPECT, IMPACT, DESIGN 중 하나여야 합니다.", 400);
  }

  try {
    const fn = await prisma.tbDsFunction.findUnique({ where: { func_id: functionId } });
    if (!fn || fn.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "기능을 찾을 수 없습니다.", 404);
    }

    const effectiveDesc   = req_cn?.trim()                     || fn.func_dc?.trim() || "";
    const commentPart     = (coment_cn || comment)?.trim()     ?? "";

    if ((taskType === "INSPECT" || taskType === "DESIGN") && !effectiveDesc) {
      return apiError("VALIDATION_ERROR", "설명(description)을 먼저 작성해 주세요.", 400);
    }

    // ── 프롬프트 템플릿 조회 ─────────────────────────────────────────────────
    // default_yn='Y' 우선, FUNCTION 전용 → 공용(ref_ty_code=null) 순
    // ref_ty_code 미지정 시 UNIT_WORK/AREA 등 다른 용도 템플릿이 걸리는 문제 방지
    const promptTmpl = await prisma.tbAiPromptTemplate.findFirst({
      where: {
        AND: [
          { OR: [{ prjct_id: projectId }, { prjct_id: null }] },
          { OR: [{ ref_ty_code: "FUNCTION" }, { ref_ty_code: null }] },
        ],
        task_ty_code: taskType,
        use_yn:       "Y",
      },
      orderBy: [
        { default_yn: "desc" },
        { ref_ty_code: { sort: "desc", nulls: "last" } },
        { prjct_id:    { sort: "desc", nulls: "last" } },
        { creat_dt:    "desc" },
      ],
    });

    const sysPrompt = promptTmpl?.sys_prompt_cn?.trim() ?? "";

    // ── 전체 설계서 컨텍스트 수집 (INSPECT만) ───────────────────────────────
    // 기능 → 영역 → 화면 → 단위업무 bottom-up 수집
    let designContextXml = "";
    if (taskType === "INSPECT") {
      const ctx = await buildDesignContext("FUNCTION", functionId);
      designContextXml = ctx.xml;
    }

    // ── 프롬프트 조립 ────────────────────────────────────────────────────────
    // 순서: 시스템프롬프트 → 전체 설계서 → 코멘트 → 점검 대상(설명)
    const parts: string[] = [];

    if (sysPrompt) {
      parts.push(`<시스템프롬프트>\n${sysPrompt}\n</시스템프롬프트>`);
    }

    if (designContextXml) {
      parts.push(designContextXml);
    }

    if (commentPart) {
      parts.push(`<코멘트>\n${commentPart}\n</코멘트>`);
    }

    if (effectiveDesc) {
      parts.push(`<점검 대상>\n${effectiveDesc}\n</점검 대상>`);
    }

    // <TABLE_SCRIPT:tb_xxx> 플레이스홀더 치환 (brief 모드 — 컬럼명 목록)
    // 설명이나 설계 컨텍스트에 테이블 참조가 포함된 경우 AI가 구조를 파악할 수 있도록 치환
    // 미등록 테이블은 원본 플레이스홀더 그대로 유지
    const finalReqCn = await expandTableScripts(projectId, parts.join("\n\n"), "brief");

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
        ref_ty_code:       "FUNCTION",
        ref_id:            functionId,
        task_ty_code:      taskType,
        coment_cn:         commentPart || null,
        req_cn:            finalReqCn,
        req_snapshot_data: {
          funcId:      functionId,
          funcName:    fn.func_nm,
          funcType:    fn.func_ty_code,
          description: fn.func_dc,
          promptTmplId:  promptTmpl?.tmpl_id   ?? null,
          promptTmplNm:  promptTmpl?.tmpl_nm   ?? null,
        },
        req_mber_id:       auth.mberId,
        task_sttus_code:   "PENDING",
        retry_cnt:         0,
      },
    });

    return apiSuccess({ aiTaskId: task.ai_task_id, status: "PENDING", taskType }, 202);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/functions/${functionId}/ai] DB 오류:`, err);
    return apiError("DB_ERROR", "AI 요청 중 오류가 발생했습니다.", 500);
  }
}
