/**
 * PUT    /api/projects/[id]/col-mapping-groups/[groupId] — 그룹 이름/순서 수정
 * DELETE /api/projects/[id]/col-mapping-groups/[groupId] — 그룹 삭제 (매핑도 함께 삭제, FK cascade)
 *
 * PUT Body: { grpNm?, sortOrdr? }
 *
 * 권한: 매핑 그룹은 소속 엔티티(기능 등) 설계 내용의 일부 → 그 엔티티의 "수정" 권한과 동일하게 판정.
 *   OWNER/ADMIN·PM/PL·가장 가까운 담당자만 통과. 아니면 사유가 담긴 403이 그대로 나간다.
 *   그룹 삭제는 엔티티 자체를 지우는 것이 아니므로 관리자 전용 DELETE 정책이 아니라 UPDATE로 판정한다.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { requireSpecContentWrite } from "@/lib/specContentWritePolicy";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import {
  isProjectEntityRefType,
  projectEntityBelongsToProject,
  type ProjectEntityRefType,
} from "@/lib/projectEntityScope";

type RouteParams = { params: Promise<{ id: string; groupId: string }> };

/**
 * 그룹을 찾아 이 프로젝트 소속인지 확인한다.
 * 소속 엔티티의 refType/refId를 알아야 권한 판정을 할 수 있으므로 PUT/DELETE 공통으로 먼저 호출한다.
 * 다른 프로젝트의 그룹이면 존재 여부를 노출하지 않기 위해 null(→ 404)로 취급한다.
 */
async function findGroupInProject(projectId: string, groupId: string) {
  const target = await prisma.tbDsColMappingGroup.findUnique({ where: { grp_id: groupId } });
  if (!target) return null;
  if (!isProjectEntityRefType(target.ref_ty_code)) return null;
  if (!await projectEntityBelongsToProject(projectId, target.ref_ty_code, target.ref_id)) return null;
  return { ...target, ref_ty_code: target.ref_ty_code as ProjectEntityRefType };
}

// ─── PUT: 그룹 이름/순서 수정 ─────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  // 인증만 먼저 확인 — 비로그인 요청이 그룹 존재 여부(404/403 차이)를 알아내지 못하게 함
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, groupId } = await params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { grpNm, sortOrdr } = body as { grpNm?: string; sortOrdr?: number };

  if (grpNm !== undefined && !grpNm.trim()) {
    return apiError("VALIDATION_ERROR", "그룹 이름은 비워둘 수 없습니다.", 400);
  }

  try {
    const target = await findGroupInProject(projectId, groupId);
    if (!target) {
      return apiError("NOT_FOUND", "매핑 그룹을 찾을 수 없습니다.", 404);
    }

    // 소속 엔티티의 수정 권한으로 판정 (담당자 아니면 사유와 함께 403)
    const gate = await requireSpecContentWrite(request, projectId, target.ref_ty_code, target.ref_id, "UPDATE");
    if (gate instanceof Response) return gate;

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

  try {
    const target = await findGroupInProject(projectId, groupId);
    if (!target) {
      return apiError("NOT_FOUND", "매핑 그룹을 찾을 수 없습니다.", 404);
    }

    // 소속 엔티티의 수정 권한으로 판정 (담당자 아니면 사유와 함께 403)
    const gate = await requireSpecContentWrite(request, projectId, target.ref_ty_code, target.ref_id, "UPDATE");
    if (gate instanceof Response) return gate;

    // 같은 ref 안에 그룹이 하나뿐이면 삭제 불가 — 매핑이 소속될 그룹이 항상 있어야 함
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
