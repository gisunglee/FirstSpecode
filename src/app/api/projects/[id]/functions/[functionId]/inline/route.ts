/**
 * PATCH /api/projects/[id]/functions/[functionId]/inline — 복잡도·공수 인라인 편집 (FID-00168, 00169)
 *
 * Body: { field: "complexity" | "effort", value: string }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; functionId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
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

  const { field, value } = body as { field?: string; value?: string };
  if (!field || value === undefined) {
    return apiError("VALIDATION_ERROR", "field와 value가 필요합니다.", 400);
  }
  if (!["complexity", "effort"].includes(field)) {
    return apiError("VALIDATION_ERROR", "field는 complexity 또는 effort여야 합니다.", 400);
  }

  try {
    const existing = await prisma.tbDsFunction.findUnique({ where: { func_id: functionId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "기능을 찾을 수 없습니다.", 404);
    }

    const updateData =
      field === "complexity"
        ? { cmplx_code: value, mdfcn_dt: new Date() }
        : { efrt_val: value || null, mdfcn_dt: new Date() };

    await prisma.$transaction([
      prisma.tbDsFunction.update({
        where: { func_id: functionId },
        data:  updateData,
      }),
      prisma.tbDsDesignChange.create({
        data: {
          prjct_id:      projectId,
          ref_tbl_nm:    "tb_ds_function",
          ref_id:        functionId,
          chg_type_code: "UPDATE",
          chg_rsn_cn:    field === "complexity" ? "복잡도 인라인 편집" : "공수 인라인 편집",
          snapshot_data: {
            funcId:    functionId,
            displayId: existing.func_display_id,
            field,
            value,
          },
          chg_mber_id: auth.mberId,
        },
      }),
    ]);

    return apiSuccess({ funcId: functionId, field, value });
  } catch (err) {
    console.error(`[PATCH /api/projects/${projectId}/functions/${functionId}/inline] DB 오류:`, err);
    return apiError("DB_ERROR", "인라인 편집 저장에 실패했습니다.", 500);
  }
}
