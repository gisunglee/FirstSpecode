/**
 * POST /api/projects/[id]/areas/[areaId]/ai — 영역 AI 태스크 요청
 *
 * Body: { taskType: "INSPECT" | "IMPACT" | "DESIGN", comment?: string }
 *   - DESIGN:  AI 화면 설계 초안 생성
 *   - INSPECT: AI 영역 명세 누락 검토
 *   - IMPACT:  AI 영향도 분석
 *
 * 영역용 AI 서비스는 기능용과 분리되어 있습니다.
 * 향후 영역 특화 전처리/후처리 로직을 이곳에 추가할 수 있습니다.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; areaId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, areaId } = await params;

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
    const area = await prisma.tbDsArea.findUnique({ where: { area_id: areaId } });
    if (!area || area.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "영역을 찾을 수 없습니다.", 404);
    }

    // 설명이 있어야 요청 가능
    const effectiveDesc = area.area_dc?.trim();
    if (!effectiveDesc) {
      return apiError("VALIDATION_ERROR", "설명(description)을 먼저 작성해 주세요.", 400);
    }

    // 영역용 요청 본문: AI 요청 코멘트 + 영역 정보 + 설명을 합산
    const TASK_LABEL: Record<string, string> = {
      DESIGN:  "AI 화면 설계 초안 생성",
      INSPECT: "AI 영역 명세 누락 검토",
      IMPACT:  "AI 영향도 분석",
    };

    const reqParts: string[] = [];
    if (comment?.trim()) reqParts.push(comment.trim());
    if (area.coment_cn?.trim()) reqParts.push(`[AI 요청 코멘트]\n${area.coment_cn.trim()}`);
    reqParts.push(
      `[${TASK_LABEL[taskType]}]`,
      `영역명: ${area.area_nm ?? ""}`,
      `유형: ${area.area_ty_code ?? ""}`,
      effectiveDesc ? `\n[설명]\n${effectiveDesc}` : "",
    );
    const finalReqCn = reqParts.filter(Boolean).join("\n");

    const task = await prisma.tbAiTask.create({
      data: {
        prjct_id:        projectId,
        ref_ty_code:     "AREA",
        ref_id:          areaId,
        task_ty_code:    taskType,
        coment_cn:       comment?.trim() || area.coment_cn?.trim() || null,
        req_cn:          finalReqCn,
        req_snapshot_data: {
          areaId:      areaId,
          areaName:    area.area_nm,
          areaType:    area.area_ty_code,
          description: area.area_dc,
          commentCn:   area.coment_cn,
        },
        req_mber_id:     auth.mberId,
        task_sttus_code: "PENDING",
      },
    });

    return apiSuccess({ aiTaskId: task.ai_task_id, status: "PENDING", taskType }, 202);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/areas/${areaId}/ai] DB 오류:`, err);
    return apiError("DB_ERROR", "AI 요청 중 오류가 발생했습니다.", 500);
  }
}
