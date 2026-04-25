/**
 * DELETE /api/projects/[id]/baseline/[baselineId] — 요구사항 확정 삭제
 *
 * 역할:
 *   - 요구사항 확정(기준선 스냅샷)을 영구 삭제 (복구 불가)
 *   - 권한: OWNER/ADMIN 역할 또는 PM/PL 직무 (permissions.ts → requirement.confirm)
 *   - 프로젝트 ID 와 baselineId 일치 검증
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; baselineId: string }> };

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, baselineId } = await params;

  const gate = await requirePermission(request, projectId, "requirement.confirm");
  if (gate instanceof Response) return gate;

  try {
    // 프로젝트 매칭 확인 — 다른 프로젝트의 baselineId 가 들어와도 안전하도록
    const baseline = await prisma.tbRqBaselineSnapshot.findUnique({
      where:  { basln_id: baselineId },
      select: { prjct_id: true },
    });

    if (!baseline || baseline.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "확정 정보를 찾을 수 없습니다.", 404);
    }

    await prisma.tbRqBaselineSnapshot.delete({ where: { basln_id: baselineId } });

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(
      `[DELETE /api/projects/${projectId}/baseline/${baselineId}] DB 오류:`,
      err
    );
    return apiError("DB_ERROR", "확정 정보 삭제 중 오류가 발생했습니다.", 500);
  }
}
