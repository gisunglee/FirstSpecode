/**
 * POST /api/projects/[id]/areas/[areaId]/ai/ascii — AI ASCII 변환 요청 (FID-00156)
 *
 * Body: { comment?: string, attachFileId?: string }
 *
 * 현재: tb_ai_task에 태스크 INSERT 후 PENDING 상태 반환 (비동기 AI 파이프라인 stub)
 * 향후: AI 워커가 task_sttus_code를 DONE/FAILED로 갱신하고 result_cn에 결과 저장
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; areaId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
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

  const { comment, attachFileId } = body as { comment?: string; attachFileId?: string };

  try {
    const area = await prisma.tbDsArea.findUnique({ where: { area_id: areaId } });
    if (!area || area.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "영역을 찾을 수 없습니다.", 404);
    }

    const task = await prisma.tbAiTask.create({
      data: {
        prjct_id:        projectId,
        ref_ty_code:     "AREA",
        ref_id:          areaId,
        task_ty_code:    "DESIGN",
        coment_cn:       comment?.trim() || null,
        req_snapshot_data: {
          areaId:       areaId,
          areaName:     area.area_nm,
          attachFileId: attachFileId || null,
        },
        req_mber_id:     auth.mberId,
        task_sttus_code: "PENDING",
      },
    });

    return apiSuccess({ aiTaskId: task.ai_task_id, status: "PENDING" }, 202);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/areas/${areaId}/ai/ascii] DB 오류:`, err);
    return apiError("DB_ERROR", "AI 요청 중 오류가 발생했습니다.", 500);
  }
}
