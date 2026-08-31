/**
 * PUT    /api/projects/[id]/col-mapping-groups/[groupId] — 그룹 이름/순서 수정
 * DELETE /api/projects/[id]/col-mapping-groups/[groupId] — 그룹 삭제 (매핑도 함께 삭제, FK cascade)
 *
 * PUT Body: { grpNm?, sortOrdr? }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import {
  isProjectEntityRefType,
  projectEntityBelongsToProject,
} from "@/lib/projectEntityScope";

type RouteParams = { params: Promise<{ id: string; groupId: string }> };

// ─── PUT: 그룹 이름/순서 수정 ─────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, groupId } = await params;

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

  const { grpNm, sortOrdr } = body as { grpNm?: string; sortOrdr?: number };

  if (grpNm !== undefined && !grpNm.trim()) {
    return apiError("VALIDATION_ERROR", "그룹 이름은 비워둘 수 없습니다.", 400);
  }

  try {
    const target = await prisma.tbDsColMappingGroup.findUnique({ where: { grp_id: groupId } });
    if (
      !target ||
      !isProjectEntityRefType(target.ref_ty_code) ||
      !await projectEntityBelongsToProject(projectId, target.ref_ty_code, target.ref_id)
    ) {
      return apiError("NOT_FOUND", "매핑 그룹을 찾을 수 없습니다.", 404);
    }

    const group = await prisma.tbDsColMappingGroup.update({
      where: { grp_id: groupId },
      data: {
        ...(grpNm !== undefined ? { grp_nm: grpNm.trim() } : {}),
        ...(sortOrdr !== undefined ? { sort_ordr: sortOrdr } : {}),
      },
    });

    return apiSuccess({ grpId: group.grp_id, grpNm: group.grp_nm, sortOrder: group.sort_ordr });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/col-mapping-groups/${groupId}] DB 오류:`, err);
    return apiError("DB_ERROR", "컬럼 매핑 그룹 수정에 실패했습니다.", 500);
  }
}

// ─── DELETE: 그룹 삭제 ───────────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, groupId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  try {
    // 같은 ref 안에 그룹이 하나뿐이면 삭제 불가 — 매핑이 소속될 그룹이 항상 있어야 함
    const target = await prisma.tbDsColMappingGroup.findUnique({ where: { grp_id: groupId } });
    if (!target) {
      return apiError("NOT_FOUND", "그룹을 찾을 수 없습니다.", 404);
    }
    if (
      !isProjectEntityRefType(target.ref_ty_code) ||
      !await projectEntityBelongsToProject(projectId, target.ref_ty_code, target.ref_id)
    ) {
      return apiError("NOT_FOUND", "매핑 그룹을 찾을 수 없습니다.", 404);
    }
    const siblingCount = await prisma.tbDsColMappingGroup.count({
      where: { ref_ty_code: target.ref_ty_code, ref_id: target.ref_id },
    });
    if (siblingCount <= 1) {
      return apiError("VALIDATION_ERROR", "마지막 남은 그룹은 삭제할 수 없습니다.", 400);
    }

    await prisma.tbDsColMappingGroup.delete({ where: { grp_id: groupId } });

    return apiSuccess({ grpId: groupId, deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/col-mapping-groups/${groupId}] DB 오류:`, err);
    return apiError("DB_ERROR", "컬럼 매핑 그룹 삭제에 실패했습니다.", 500);
  }
}
