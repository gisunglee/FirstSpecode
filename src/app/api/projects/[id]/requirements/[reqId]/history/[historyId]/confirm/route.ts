/**
 * POST /api/projects/[id]/requirements/[reqId]/history/[historyId]/confirm — 버전 확정 (FID-00122)
 *
 * - INTERNAL → CONFIRMED 승격
 * - 최대 CONFIRMED 버전(V{N}) 기준 +1 로 메이저 버전 산정 (V2, V3, ...)
 * - 이미 CONFIRMED면 400 반환
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; reqId: string; historyId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, reqId, historyId } = await params;

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

  const { comment } = (body ?? {}) as { comment?: string };

  try {
    const history = await prisma.tbRqRequirementHistory.findUnique({
      where:  { req_hist_id: historyId },
      select: { req_id: true, vrsn_ty_code: true, vrsn_no: true },
    });

    if (!history || history.req_id !== reqId) {
      return apiError("NOT_FOUND", "이력을 찾을 수 없습니다.", 404);
    }
    if (history.vrsn_ty_code === "CONFIRMED") {
      return apiError("VALIDATION_ERROR", "이미 확정된 버전입니다.", 400);
    }

    // 현재 최대 CONFIRMED 버전 조회 → 메이저 버전 +1 산정
    // CONFIRMED 버전 번호는 "V2", "V3" 형태 (V1은 초기값이므로 최소 V2부터 시작)
    const lastConfirmed = await prisma.tbRqRequirementHistory.findFirst({
      where:   { req_id: reqId, vrsn_ty_code: "CONFIRMED" },
      orderBy: { creat_dt: "desc" },
      select:  { vrsn_no: true },
    });

    let nextMajor: number;
    if (!lastConfirmed) {
      // 아직 확정 버전 없음 → V2 가 첫 확정
      nextMajor = 2;
    } else {
      // "V3" → major = 3 → 다음 = 4
      const major = parseInt(lastConfirmed.vrsn_no.replace("V", ""), 10);
      nextMajor = isNaN(major) ? 2 : major + 1;
    }
    const newVersion = `V${nextMajor}`;

    await prisma.tbRqRequirementHistory.update({
      where: { req_hist_id: historyId },
      data:  {
        vrsn_no:        newVersion,
        vrsn_ty_code:   "CONFIRMED",
        vrsn_coment_cn: comment?.trim() || null,
      },
    });

    return apiSuccess({ newVersion });
  } catch (err) {
    console.error(
      `[POST /api/projects/${projectId}/requirements/${reqId}/history/${historyId}/confirm] DB 오류:`,
      err
    );
    return apiError("DB_ERROR", "확정 처리 중 오류가 발생했습니다.", 500);
  }
}
