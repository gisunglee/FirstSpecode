/**
 * PUT    /api/projects/[id]/code-groups/[grpCode] — 코드 그룹 수정
 * DELETE /api/projects/[id]/code-groups/[grpCode] — 코드 그룹 삭제 (하위 코드 cascade)
 *
 * 역할:
 *   - 프로젝트 스코프 — params.id(prjct_id) + params.grpCode(grp_code 문자열)로 조회
 *   - 그룹 코드/그룹명/설명/사용여부 수정 (각각 같은 프로젝트 내 중복 검증)
 *   - 그룹 삭제 시 하위 코드도 cascade 삭제
 *
 * 주요 기술:
 *   - tb_cm_code_group은 (prjct_id, grp_code) 유니크 제약
 *   - 내부 PK는 grp_code_id(serial)이므로 grp_code 변경도 단순 update로 처리
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; grpCode: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, grpCode } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  let body: { newGrpCode?: string; grpCodeNm?: string; grpCodeDc?: string; useYn?: string };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  try {
    // 프로젝트 스코프로 그룹 조회
    const existing = await prisma.tbCmCodeGroup.findUnique({
      where: { prjct_id_grp_code: { prjct_id: projectId, grp_code: grpCode } },
    });
    if (!existing) return apiError("NOT_FOUND", "코드 그룹을 찾을 수 없습니다.", 404);

    // 그룹 코드 변경 시 같은 프로젝트 내 중복 체크
    const newCode = body.newGrpCode?.trim();
    if (newCode && newCode !== grpCode) {
      const dup = await prisma.tbCmCodeGroup.findUnique({
        where: { prjct_id_grp_code: { prjct_id: projectId, grp_code: newCode } },
      });
      if (dup) return apiError("DUPLICATE", "이미 존재하는 그룹 코드입니다.", 409);
    }

    // 그룹명 변경 시 같은 프로젝트 내 중복 체크
    if (body.grpCodeNm !== undefined && body.grpCodeNm.trim() !== existing.grp_code_nm) {
      const dupNm = await prisma.tbCmCodeGroup.findUnique({
        where: { prjct_id_grp_code_nm: { prjct_id: projectId, grp_code_nm: body.grpCodeNm.trim() } },
      });
      if (dupNm && dupNm.grp_code_id !== existing.grp_code_id) {
        return apiError("DUPLICATE", "이미 존재하는 그룹명입니다.", 409);
      }
    }

    // 단일 update — grp_code_id가 surrogate PK이므로 grp_code 변경도 자유
    const updated = await prisma.tbCmCodeGroup.update({
      where: { grp_code_id: existing.grp_code_id },
      data: {
        ...(newCode && newCode !== grpCode ? { grp_code: newCode } : {}),
        ...(body.grpCodeNm !== undefined ? { grp_code_nm: body.grpCodeNm.trim() } : {}),
        ...(body.grpCodeDc !== undefined ? { grp_code_dc: body.grpCodeDc.trim() || null } : {}),
        ...(body.useYn !== undefined ? { use_yn: body.useYn } : {}),
        mdfcn_dt: new Date(),
      },
    });

    return apiSuccess({ grpCode: updated.grp_code, grpCodeNm: updated.grp_code_nm });
  } catch (err) {
    console.error(`[PUT /api/code-groups/${grpCode}]`, err);
    return apiError("DB_ERROR", "코드 그룹 수정에 실패했습니다.", 500);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, grpCode } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const existing = await prisma.tbCmCodeGroup.findUnique({
      where: { prjct_id_grp_code: { prjct_id: projectId, grp_code: grpCode } },
    });
    if (!existing) return apiError("NOT_FOUND", "코드 그룹을 찾을 수 없습니다.", 404);

    // cascade 삭제 (Prisma relation onDelete: Cascade)
    await prisma.tbCmCodeGroup.delete({ where: { grp_code_id: existing.grp_code_id } });

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/code-groups/${grpCode}]`, err);
    return apiError("DB_ERROR", "코드 그룹 삭제에 실패했습니다.", 500);
  }
}
