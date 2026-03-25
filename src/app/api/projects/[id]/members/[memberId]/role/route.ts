/**
 * PATCH /api/projects/[id]/members/[memberId]/role — 역할 변경 (FID-00073)
 *
 * 역할:
 *   - ADMIN/OWNER만 변경 가능
 *   - OWNER 승격은 OWNER 본인만 가능
 *   - 마지막 OWNER 강등 거부
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; memberId: string }> };

const VALID_ROLES = ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER", "VIEWER"];

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, memberId } = await params;

  // 요청자 권한 확인
  const myMembership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!myMembership || myMembership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  // ADMIN/OWNER만 역할 변경 가능
  if (!["ADMIN", "OWNER"].includes(myMembership.role_code)) {
    return apiError("FORBIDDEN", "역할 변경 권한이 없습니다.", 403);
  }

  // 요청 바디 파싱
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { role } = body as { role?: string };

  if (!role || !VALID_ROLES.includes(role)) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 역할입니다.", 400);
  }

  // 대상 멤버 조회
  const target = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: memberId } },
  });
  if (!target || target.mber_sttus_code !== "ACTIVE") {
    return apiError("NOT_FOUND", "멤버를 찾을 수 없습니다.", 404);
  }

  // OWNER 승격은 OWNER 본인만 가능
  if (role === "OWNER" && myMembership.role_code !== "OWNER") {
    return apiError("FORBIDDEN", "OWNER 승격은 OWNER만 가능합니다.", 403);
  }

  // 마지막 OWNER 보호: 대상이 OWNER이고, 현재 OWNER가 1명뿐이면 강등 거부
  if (target.role_code === "OWNER" && role !== "OWNER") {
    const ownerCount = await prisma.tbPjProjectMember.count({
      where: { prjct_id: projectId, role_code: "OWNER", mber_sttus_code: "ACTIVE" },
    });
    if (ownerCount <= 1) {
      return apiError("LAST_OWNER", "OWNER는 최소 1명 이상 유지되어야 합니다.", 400);
    }
  }

  try {
    await prisma.tbPjProjectMember.update({
      where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: memberId } },
      data: { role_code: role, sttus_chg_dt: new Date() },
    });

    return apiSuccess({ memberId, role });
  } catch (err) {
    console.error(`[PATCH /api/projects/${projectId}/members/${memberId}/role] DB 오류:`, err);
    return apiError("DB_ERROR", "역할 변경 중 오류가 발생했습니다.", 500);
  }
}
