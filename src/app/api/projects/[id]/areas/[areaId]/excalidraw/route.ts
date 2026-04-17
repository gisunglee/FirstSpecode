/**
 * PATCH /api/projects/[id]/areas/[areaId]/excalidraw — Excalidraw 데이터 저장 (FID-00165)
 *
 * Body: { data: object }  — Excalidraw JSON (elements, appState, files)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; areaId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
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

  const { data } = body as { data?: unknown };
  if (data === undefined) {
    return apiError("VALIDATION_ERROR", "Excalidraw 데이터가 필요합니다.", 400);
  }

  try {
    const existing = await prisma.tbDsArea.findUnique({ where: { area_id: areaId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "영역을 찾을 수 없습니다.", 404);
    }

    // Excalidraw JSON 저장 + 설계 변경 이력 (트랜잭션)
    await prisma.$transaction([
      prisma.tbDsArea.update({
        where: { area_id: areaId },
        data:  { excaldw_data: data as object, mdfcn_dt: new Date() },
      }),
      prisma.tbDsDesignChange.create({
        data: {
          prjct_id:      projectId,
          ref_tbl_nm:    "tb_ds_area",
          ref_id:        areaId,
          chg_type_code: "UPDATE",
          chg_rsn_cn:    "Excalidraw 설계 저장",
          snapshot_data: {
            areaId:    areaId,
            displayId: existing.area_display_id,
            name:      existing.area_nm,
            savedAt:   new Date().toISOString(),
          },
          chg_mber_id: auth.mberId,
        },
      }),
    ]);

    return apiSuccess({ areaId, saved: true });
  } catch (err) {
    console.error(`[PATCH /api/projects/${projectId}/areas/${areaId}/excalidraw] DB 오류:`, err);
    return apiError("DB_ERROR", "Excalidraw 저장 중 오류가 발생했습니다.", 500);
  }
}
