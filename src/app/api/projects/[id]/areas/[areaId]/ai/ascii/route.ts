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
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; areaId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, areaId } = await params;

  // 권한 가드 — 역할 매트릭스(permissions.ts) 기반.
  // 결제 잠금(§1-6)·지원 세션 읽기전용·프로젝트 삭제 상태도 requirePermission 이 함께 처리한다.
  const auth = await requirePermission(request, projectId, "ai.request");
  if (auth instanceof Response) return auth;

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
