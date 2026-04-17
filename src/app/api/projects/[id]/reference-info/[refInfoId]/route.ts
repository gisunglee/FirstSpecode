/**
 * GET    /api/projects/[id]/reference-info/[refInfoId] — 기준 정보 단건 조회
 * PUT    /api/projects/[id]/reference-info/[refInfoId] — 기준 정보 수정
 * DELETE /api/projects/[id]/reference-info/[refInfoId] — 기준 정보 논리삭제
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; refInfoId: string }> };

// ─── GET: 단건 조회 ─────────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, refInfoId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const r = await prisma.tbCmReferenceInfo.findUnique({ where: { ref_info_id: refInfoId } });
    if (!r || r.del_yn === "Y") return apiError("NOT_FOUND", "기준 정보를 찾을 수 없습니다.", 404);

    return apiSuccess({
      refInfoId:     r.ref_info_id,
      refInfoCode:   r.ref_info_code,
      refBgngDe:     r.ref_bgng_de,
      refEndDe:      r.ref_end_de,
      refInfoNm:     r.ref_info_nm,
      busDivCode:    r.bus_div_code,
      refDataTyCode: r.ref_data_ty_code,
      mainRefVal:    r.main_ref_val,
      subRefVal:     r.sub_ref_val,
      refInfoDc:     r.ref_info_dc,
      useYn:         r.use_yn,
    });
  } catch (err) {
    console.error(`[GET /reference-info/${refInfoId}] DB 오류:`, err);
    return apiError("DB_ERROR", "조회에 실패했습니다.", 500);
  }
}

// ─── PUT: 수정 (use_yn 토글 포함) ────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, refInfoId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM"]);
  if (roleCheck) return roleCheck;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const {
    refInfoCode, refBgngDe, refEndDe, refInfoNm,
    busDivCode, refDataTyCode, mainRefVal, subRefVal, refInfoDc, useYn,
  } = body as {
    refInfoCode?: string; refBgngDe?: string; refEndDe?: string;
    refInfoNm?: string; busDivCode?: string; refDataTyCode?: string;
    mainRefVal?: string; subRefVal?: string; refInfoDc?: string; useYn?: string;
  };

  try {
    const existing = await prisma.tbCmReferenceInfo.findUnique({ where: { ref_info_id: refInfoId } });
    if (!existing || existing.del_yn === "Y") {
      return apiError("NOT_FOUND", "기준 정보를 찾을 수 없습니다.", 404);
    }

    // useYn만 변경하는 토글 요청인지 판별
    const isToggle = useYn !== undefined && !refInfoNm;

    if (!isToggle) {
      if (!refInfoCode?.trim()) return apiError("VALIDATION_ERROR", "기준 정보 코드를 입력해 주세요.", 400);
      if (!refBgngDe?.trim()) return apiError("VALIDATION_ERROR", "기준 시작 일자를 입력해 주세요.", 400);
      if (!refInfoNm?.trim()) return apiError("VALIDATION_ERROR", "기준 정보 명을 입력해 주세요.", 400);
    }

    await prisma.tbCmReferenceInfo.update({
      where: { ref_info_id: refInfoId },
      data: isToggle
        ? { use_yn: useYn, mdfcn_mber_id: auth.mberId, mdfcn_dt: new Date() }
        : {
            ref_info_code:    refInfoCode!.trim(),
            ref_bgng_de:      refBgngDe!.trim(),
            ref_end_de:       refEndDe?.trim() || null,
            ref_info_nm:      refInfoNm!.trim(),
            bus_div_code:     busDivCode?.trim() || existing.bus_div_code,
            ref_data_ty_code: refDataTyCode?.trim() || existing.ref_data_ty_code,
            main_ref_val:     mainRefVal?.trim() || null,
            sub_ref_val:      subRefVal?.trim() || null,
            ref_info_dc:      refInfoDc?.trim() || null,
            use_yn:           useYn ?? existing.use_yn,
            mdfcn_mber_id:    auth.mberId,
            mdfcn_dt:         new Date(),
          },
    });

    return apiSuccess({ ok: true });
  } catch (err) {
    console.error(`[PUT /reference-info/${refInfoId}] DB 오류:`, err);
    return apiError("DB_ERROR", "수정에 실패했습니다.", 500);
  }
}

// ─── DELETE: 논리삭제 ────────────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, refInfoId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM"]);
  if (roleCheck) return roleCheck;

  try {
    const existing = await prisma.tbCmReferenceInfo.findUnique({ where: { ref_info_id: refInfoId } });
    if (!existing || existing.del_yn === "Y") {
      return apiError("NOT_FOUND", "기준 정보를 찾을 수 없습니다.", 404);
    }

    // 논리삭제
    await prisma.tbCmReferenceInfo.update({
      where: { ref_info_id: refInfoId },
      data: { del_yn: "Y", mdfcn_mber_id: auth.mberId, mdfcn_dt: new Date() },
    });

    return apiSuccess({ ok: true });
  } catch (err) {
    console.error(`[DELETE /reference-info/${refInfoId}] DB 오류:`, err);
    return apiError("DB_ERROR", "삭제에 실패했습니다.", 500);
  }
}
