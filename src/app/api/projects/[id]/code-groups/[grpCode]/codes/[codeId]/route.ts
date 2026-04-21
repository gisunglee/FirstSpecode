/**
 * PUT    /api/projects/[id]/code-groups/[grpCode]/codes/[codeId] — 코드 수정
 * DELETE /api/projects/[id]/code-groups/[grpCode]/codes/[codeId] — 코드 삭제
 *
 * codeId = cm_code_id (serial PK)
 * cm_code는 일반 unique 컬럼으로, 프론트에서 변경 가능
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; grpCode: string; codeId: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, codeId: codeIdStr } = await params;
  const codeId = parseInt(codeIdStr);
  if (isNaN(codeId) || codeId <= 0) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 코드 ID입니다.", 400);
  }

  const gate = await requirePermission(request, projectId, "code.write");
  if (gate instanceof Response) return gate;

  let body: { cmCode?: string; codeNm?: string; codeDc?: string; useYn?: string; sortOrdr?: number; globalUnique?: boolean };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  try {
    // 프로젝트 스코프 검증 — 다른 프로젝트의 코드를 수정/조회 못하도록
    const existing = await prisma.tbCmCode.findUnique({ where: { cm_code_id: codeId } });
    if (!existing) return apiError("NOT_FOUND", "코드를 찾을 수 없습니다.", 404);
    if (existing.prjct_id !== projectId) return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);

    // cm_code 변경 시 형식 검증 + 중복 체크
    if (body.cmCode !== undefined && body.cmCode.trim() !== existing.cm_code) {
      const newCmCode = body.cmCode.trim();
      if (!newCmCode) return apiError("VALIDATION_ERROR", "코드를 입력해 주세요.", 400);
      if (!/^[A-Za-z0-9_:\-]+$/.test(newCmCode)) {
        return apiError("VALIDATION_ERROR", "코드는 영문, 숫자, _, :, - 만 입력 가능합니다.", 400);
      }
      // 같은 그룹 내 중복 체크 (필수)
      const dupInGroup = await prisma.tbCmCode.findFirst({
        where: { grp_code_id: existing.grp_code_id, cm_code: newCmCode, cm_code_id: { not: codeId } },
      });
      if (dupInGroup) return apiError("DUPLICATE", "같은 그룹 내에 이미 존재하는 코드입니다.", 409);

      // globalUnique 옵션: 같은 프로젝트 내 모든 그룹에서 중복 체크
      if (body.globalUnique) {
        const dupGlobal = await prisma.tbCmCode.findFirst({
          where: { prjct_id: projectId, cm_code: newCmCode, cm_code_id: { not: codeId } },
        });
        if (dupGlobal) return apiError("DUPLICATE", "프로젝트 내 다른 그룹에 이미 존재하는 코드입니다.", 409);
      }
    }
    // 코드명 중복 체크 제거 — 코드명은 자유 입력 허용

    const updated = await prisma.tbCmCode.update({
      where: { cm_code_id: codeId },
      data: {
        ...(body.cmCode !== undefined ? { cm_code: body.cmCode.trim() } : {}),
        ...(body.codeNm !== undefined ? { code_nm: body.codeNm.trim() } : {}),
        ...(body.codeDc !== undefined ? { code_dc: body.codeDc.trim() || null } : {}),
        ...(body.useYn !== undefined ? { use_yn: body.useYn } : {}),
        ...(body.sortOrdr !== undefined ? { sort_ordr: body.sortOrdr } : {}),
        mdfcn_dt: new Date(),
      },
    });

    return apiSuccess({ codeId: updated.cm_code_id, cmCode: updated.cm_code, codeNm: updated.code_nm });
  } catch (err) {
    console.error(`[PUT /api/codes/${codeId}]`, err);
    return apiError("DB_ERROR", "코드 수정에 실패했습니다.", 500);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, codeId: codeIdStr } = await params;
  const codeId = parseInt(codeIdStr);
  if (isNaN(codeId) || codeId <= 0) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 코드 ID입니다.", 400);
  }

  const gate = await requirePermission(request, projectId, "code.write");
  if (gate instanceof Response) return gate;

  try {
    // 프로젝트 스코프 검증
    const existing = await prisma.tbCmCode.findUnique({ where: { cm_code_id: codeId } });
    if (!existing) return apiError("NOT_FOUND", "코드를 찾을 수 없습니다.", 404);
    if (existing.prjct_id !== projectId) return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);

    await prisma.tbCmCode.delete({ where: { cm_code_id: codeId } });

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/codes/${codeId}]`, err);
    return apiError("DB_ERROR", "코드 삭제에 실패했습니다.", 500);
  }
}
