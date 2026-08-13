/**
 * PATCH /api/projects/[id]/areas/[areaId]/excalidraw — Excalidraw 데이터 저장 (FID-00165)
 *
 * Body: { data: object }  — Excalidraw JSON (elements, appState, files)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import {
  creatorWindowConflict,
  requireSpecChangedFields,
  requireSpecContentWrite,
} from "@/lib/specContentWritePolicy";
import { isCreatorWindowConflict, lockAndAssertCreatorWindow } from "@/lib/specContentWriteConcurrency";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { excalidrawUpdateSchema } from "@/lib/specContentSchemas";

type RouteParams = { params: Promise<{ id: string; areaId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, areaId } = await params;
  const gate = await requireSpecContentWrite(request, projectId, "AREA", areaId);
  if (gate instanceof Response) return gate;

  const parsed = await parseJsonBody(request, excalidrawUpdateSchema);
  if (parsed instanceof Response) return parsed;
  const { data } = parsed.data;
  const fieldError = requireSpecChangedFields(gate, "AREA", ["excalidrawData"]);
  if (fieldError) return fieldError;

  try {
    const existing = await prisma.tbDsArea.findUnique({ where: { area_id: areaId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "영역을 찾을 수 없습니다.", 404);
    }

    // Excalidraw JSON 저장 + 설계 변경 이력 (트랜잭션)
    await prisma.$transaction(async (tx) => {
      await lockAndAssertCreatorWindow(tx, "AREA", areaId, gate);
      await Promise.all([
        tx.tbDsArea.update({
          where: { area_id: areaId },
          data:  { excaldw_data: data as object, mdfcn_mber_id: gate.mberId, mdfcn_dt: new Date() },
        }),
        tx.tbDsDesignChange.create({
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
            chg_mber_id: gate.mberId,
          },
        }),
      ]);
    });

    return apiSuccess({ areaId, saved: true });
  } catch (err) {
    if (isCreatorWindowConflict(err)) return creatorWindowConflict();
    console.error(`[PATCH /api/projects/${projectId}/areas/${areaId}/excalidraw] DB 오류:`, err);
    return apiError("DB_ERROR", "Excalidraw 저장 중 오류가 발생했습니다.", 500);
  }
}
