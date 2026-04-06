/**
 * PUT    /api/projects/[id]/code-groups/[grpCode]/codes/[codeId] — 코드 수정
 * DELETE /api/projects/[id]/code-groups/[grpCode]/codes/[codeId] — 코드 삭제
 *
 * codeId = cm_code (VARCHAR PK)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; grpCode: string; codeId: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, codeId: cmCode } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  let body: { codeNm?: string; codeDc?: string; useYn?: string; sortOrdr?: number };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  try {
    const existing = await prisma.tbCmCode.findUnique({ where: { cm_code: cmCode } });
    if (!existing) return apiError("NOT_FOUND", "코드를 찾을 수 없습니다.", 404);

    const { grpCode } = await params;

    // 코드명 변경 시 같은 그룹 내 중복 체크
    if (body.codeNm !== undefined && body.codeNm.trim() !== existing.code_nm) {
      const dup = await prisma.tbCmCode.findUnique({
        where: { grp_code_code_nm: { grp_code: existing.grp_code, code_nm: body.codeNm.trim() } },
      });
      if (dup && dup.cm_code !== cmCode) {
        return apiError("DUPLICATE", "같은 그룹 내에 이미 존재하는 코드명입니다.", 409);
      }
    }

    const updated = await prisma.tbCmCode.update({
      where: { cm_code: cmCode },
      data: {
        ...(body.codeNm !== undefined ? { code_nm: body.codeNm.trim() } : {}),
        ...(body.codeDc !== undefined ? { code_dc: body.codeDc.trim() || null } : {}),
        ...(body.useYn !== undefined ? { use_yn: body.useYn } : {}),
        ...(body.sortOrdr !== undefined ? { sort_ordr: body.sortOrdr } : {}),
        mdfcn_dt: new Date(),
      },
    });

    return apiSuccess({ cmCode: updated.cm_code, codeNm: updated.code_nm });
  } catch (err) {
    console.error(`[PUT /api/codes/${cmCode}]`, err);
    return apiError("DB_ERROR", "코드 수정에 실패했습니다.", 500);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, codeId: cmCode } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const existing = await prisma.tbCmCode.findUnique({ where: { cm_code: cmCode } });
    if (!existing) return apiError("NOT_FOUND", "코드를 찾을 수 없습니다.", 404);

    await prisma.tbCmCode.delete({ where: { cm_code: cmCode } });

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/codes/${cmCode}]`, err);
    return apiError("DB_ERROR", "코드 삭제에 실패했습니다.", 500);
  }
}
