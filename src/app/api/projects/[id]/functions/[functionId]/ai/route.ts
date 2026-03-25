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

  const { taskType, comment } = body as { taskType?: string; comment?: string };
  if (!taskType || !["INSPECT", "IMPACT", "DESIGN"].includes(taskType)) {
    return apiError("VALIDATION_ERROR", "taskType은 INSPECT, IMPACT, DESIGN 중 하나여야 합니다.", 400);
  }

  try {
    const fn = await prisma.tbDsFunction.findUnique({ where: { func_id: functionId } });
    if (!fn || fn.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "기능을 찾을 수 없습니다.", 404);
    }

    // INSPECT: 명세가 있어야 함
    if (taskType === "INSPECT" && !fn.spec_cn?.trim()) {
      return apiError("VALIDATION_ERROR", "명세(spec)를 먼저 작성해 주세요.", 400);
    }

    const task = await prisma.tbAiTask.create({
      data: {
        prjct_id:        projectId,
        ref_ty_code:     "FUNCTION",
        ref_id:          functionId,
        task_ty_code:    taskType,
        coment_cn:       comment?.trim() || null,
        req_snapshot_data: {
          funcId:    functionId,
          funcName:  fn.func_nm,
          funcType:  fn.func_ty_code,
          spec:      fn.spec_cn,
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
