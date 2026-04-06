/**
 * PUT    /api/projects/[id]/code-groups/[grpCode] — 코드 그룹 수정
 * DELETE /api/projects/[id]/code-groups/[grpCode] — 코드 그룹 삭제 (하위 코드 cascade)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; grpCode: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
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
    const existing = await prisma.tbCmCodeGroup.findUnique({ where: { grp_code: grpCode } });
    if (!existing) return apiError("NOT_FOUND", "코드 그룹을 찾을 수 없습니다.", 404);

    const newCode = body.newGrpCode?.trim();

    // 그룹 코드(PK) 변경 요청인 경우 — 하위 코드 FK도 함께 업데이트
    if (newCode && newCode !== grpCode) {
      // 새 코드 중복 확인
      const dup = await prisma.tbCmCodeGroup.findUnique({ where: { grp_code: newCode } });
      if (dup) return apiError("DUPLICATE", "이미 존재하는 그룹 코드입니다.", 409);

      // FK + unique(grp_code_nm) 제약 우회:
      // ① 구 그룹 코드명을 임시값으로 변경 → ② 새 그룹 생성 → ③ 코드 이전 → ④ 구 그룹 삭제
      const finalNm = body.grpCodeNm?.trim() ?? existing.grp_code_nm;
      await prisma.$transaction(async (tx) => {
        await tx.tbCmCodeGroup.update({
          where: { grp_code: grpCode },
          data: { grp_code_nm: `__tmp_${Date.now()}` },
        });
        await tx.tbCmCodeGroup.create({
          data: {
            grp_code: newCode,
            grp_code_nm: finalNm,
            grp_code_dc: body.grpCodeDc !== undefined ? (body.grpCodeDc.trim() || null) : existing.grp_code_dc,
            use_yn: body.useYn ?? existing.use_yn,
            creat_dt: existing.creat_dt,
          },
        });
        await tx.tbCmCode.updateMany({
          where: { grp_code: grpCode },
          data: { grp_code: newCode },
        });
        await tx.tbCmCodeGroup.delete({ where: { grp_code: grpCode } });
      });

      return apiSuccess({ grpCode: newCode, grpCodeNm: body.grpCodeNm?.trim() ?? existing.grp_code_nm });
    }

    // 일반 필드만 수정
    const updated = await prisma.tbCmCodeGroup.update({
      where: { grp_code: grpCode },
      data: {
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
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, grpCode } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const existing = await prisma.tbCmCodeGroup.findUnique({ where: { grp_code: grpCode } });
    if (!existing) return apiError("NOT_FOUND", "코드 그룹을 찾을 수 없습니다.", 404);

    // cascade 삭제 (Prisma relation onDelete: Cascade)
    await prisma.tbCmCodeGroup.delete({ where: { grp_code: grpCode } });

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/code-groups/${grpCode}]`, err);
    return apiError("DB_ERROR", "코드 그룹 삭제에 실패했습니다.", 500);
  }
}
