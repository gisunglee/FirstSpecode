/**
 * POST /api/projects/[id]/functions/[functionId]/ai — AI 태스크 요청 (FID-00174, 00175)
 *
 * Body: { taskType: "INSPECT" | "IMPACT" | "DESIGN", comment?: string }
 *   - INSPECT: AI 명세 누락 검토 (FID-00174)
 *   - IMPACT:  AI 영향도 분석 (FID-00175)
 *   - DESIGN:  AI 컬럼 매핑 초안 생성 (FID-00180)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; functionId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
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
    taskType?: string; 
    comment?: string; 
    coment_cn?: string; 
    req_cn?: string;
  };
  if (!taskType || !["INSPECT", "IMPACT", "DESIGN"].includes(taskType)) {
    return apiError("VALIDATION_ERROR", "taskType은 INSPECT, IMPACT, DESIGN 중 하나여야 합니다.", 400);
  }

  try {
    const fn = await prisma.tbDsFunction.findUnique({ where: { func_id: functionId } });
    if (!fn || fn.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "기능을 찾을 수 없습니다.", 404);
    }

    // INSPECT: 설명이 있어야 함 (전송받은 req_cn 또는 DB의 func_dc)
    const effectiveDesc = req_cn?.trim() || fn.func_dc?.trim();
    if (taskType === "INSPECT" && !effectiveDesc) {
      return apiError("VALIDATION_ERROR", "설명(description)을 먼저 작성해 주세요.", 400);
    }

    let finalReqCn: string;

    if (taskType === "DESIGN") {
      // DESIGN: 프롬프트 템플릿(task_ty_code=DESIGN, ref_ty_code=FUNCTION, use_yn=Y) 조회
      // 프로젝트 전용 템플릿 우선, 없으면 시스템 공통 템플릿(prjct_id=null) 사용
      // 여러 개일 경우 마지막에 추가된 것 사용 (creat_dt desc)
      // 프로젝트 전용 템플릿이 있으면 시스템 공통보다 우선
      const promptTmpl = await prisma.tbAiPromptTemplate.findFirst({
        where: {
          OR: [{ prjct_id: projectId }, { prjct_id: null }],
          task_ty_code: "DESIGN",
          ref_ty_code:  "FUNCTION",
          use_yn:       "Y",
        },
        orderBy: [
          { prjct_id: { sort: "desc", nulls: "last" } },
          { creat_dt:  "desc" },
        ],
      });

      const sysPrompt   = promptTmpl?.sys_prompt_cn?.trim() ?? "";
      const commentPart = (coment_cn || comment)?.trim() ?? "";
      const descPart    = (req_cn || fn.func_dc)?.trim() ?? "";

      // 시스템 프롬프트 뒤에 <COMMENT>와 <점검 대상> 태그로 내용 추가
      const parts: string[] = [];
      if (sysPrompt)    parts.push(sysPrompt);
      if (commentPart)  parts.push(`<COMMENT>\n${commentPart}\n</COMMENT>`);
      if (descPart)     parts.push(`<점검 대상>\n${descPart}\n</점검 대상>`);
      finalReqCn = parts.join("\n\n");

      // 사용 횟수 증가
      if (promptTmpl) {
        await prisma.tbAiPromptTemplate.update({
          where: { tmpl_id: promptTmpl.tmpl_id },
          data:  { use_cnt: { increment: 1 } },
        });
      }
    } else {
      // INSPECT / IMPACT: 기존 방식 유지
      // req_cn이 바디에 포함되어 있으면 그대로 사용, 없으면 레거시 형식으로 생성
      const rawReqCn = req_cn?.trim();
      if (rawReqCn) {
        finalReqCn = rawReqCn;
      } else {
        const TASK_LABEL: Record<string, string> = {
          INSPECT: "AI 명세 누락 검토",
          IMPACT:  "AI 영향도 분석",
        };
        const reqParts: string[] = [];
        if ((coment_cn || comment)?.trim()) reqParts.push((coment_cn || comment)!.trim());
        reqParts.push(
          `[${TASK_LABEL[taskType] ?? taskType}]`,
          `기능명: ${fn.func_nm ?? ""}`,
          `유형: ${fn.func_ty_code ?? ""}`,
          fn.func_dc?.trim() ? `\n[설명]\n${fn.func_dc.trim()}` : "",
        );
        finalReqCn = reqParts.filter(Boolean).join("\n");
      }
    }

    const task = await prisma.tbAiTask.create({
      data: {
        prjct_id:        projectId,
        ref_ty_code:     "FUNCTION",
        ref_id:          functionId,
        task_ty_code:    taskType,
        coment_cn:       coment_cn?.trim() || comment?.trim() || null,
        req_cn:          finalReqCn,
        req_snapshot_data: {
          funcId:      functionId,
          funcName:    fn.func_nm,
          funcType:    fn.func_ty_code,
          description: fn.func_dc,
        },
        req_mber_id:     auth.mberId,
        task_sttus_code: "PENDING",
      },
    });

    return apiSuccess({ aiTaskId: task.ai_task_id, status: "PENDING", taskType }, 202);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/functions/${functionId}/ai] DB 오류:`, err);
    return apiError("DB_ERROR", "AI 요청 중 오류가 발생했습니다.", 500);
  }
}
