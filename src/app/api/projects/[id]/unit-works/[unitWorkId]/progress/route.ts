/**
 * PATCH /api/projects/[id]/unit-works/[unitWorkId]/progress — 진행률 인라인 수정 (FID-00133)
 *
 * 목록 행에서 진행률만 즉시 수정하는 경량 엔드포인트.
 * 전체 PUT과 달리 progress 필드만 검증·업데이트한다.
 *
 * Body: { progress: number (0~100) }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; unitWorkId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
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

  const { progress } = body as { progress?: number };

  if (progress === undefined || progress === null) {
    return apiError("VALIDATION_ERROR", "progress 값이 필요합니다.", 400);
  }
  // 진행률은 0~100 정수만 허용
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
    return apiError("VALIDATION_ERROR", "진행률은 0~100 사이 정수여야 합니다.", 400);
  }

  try {
    const existing = await prisma.tbDsUnitWork.findUnique({ where: { unit_work_id: unitWorkId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "단위업무를 찾을 수 없습니다.", 404);
    }

    await prisma.tbDsUnitWork.update({
      where: { unit_work_id: unitWorkId },
      data:  { progrs_rt: progress, mdfcn_dt: new Date() },
    });

    return apiSuccess({ unitWorkId, progress });
  } catch (err) {
    console.error(`[PATCH /api/projects/${projectId}/unit-works/${unitWorkId}/progress] DB 오류:`, err);
    return apiError("DB_ERROR", "진행률 변경 중 오류가 발생했습니다.", 500);
  }
}
