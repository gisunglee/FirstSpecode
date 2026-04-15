/**
 * GET  /api/projects/[id]/reference-info — 기준 정보 목록 조회
 * POST /api/projects/[id]/reference-info — 기준 정보 생성
 *
 * 시스템 공통 설정값(key-value) 관리
 * 프로젝트 멤버 인증만 필요 (데이터는 전역)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 기준 정보 목록 조회 ────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  // 프로젝트 멤버 인증
  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const items = await prisma.tbCmReferenceInfo.findMany({
      where: { del_yn: "N" },
      orderBy: [{ bus_div_code: "asc" }, { ref_info_code: "asc" }, { ref_bgng_de: "desc" }],
    });

    return apiSuccess({
      items: items.map((r) => ({
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
        creatDt:       r.creat_dt,
        mdfcnDt:       r.mdfcn_dt,
      })),
      totalCount: items.length,
    });
  } catch (err) {
    console.error("[GET /api/.../reference-info] DB 오류:", err);
    return apiError("DB_ERROR", "기준 정보 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 기준 정보 생성 ────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

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
    busDivCode, refDataTyCode, mainRefVal, subRefVal, refInfoDc,
  } = body as {
    refInfoCode?: string; refBgngDe?: string; refEndDe?: string;
    refInfoNm?: string; busDivCode?: string; refDataTyCode?: string;
    mainRefVal?: string; subRefVal?: string; refInfoDc?: string;
  };

  if (!refInfoCode?.trim()) return apiError("VALIDATION_ERROR", "기준 정보 코드를 입력해 주세요.", 400);
  if (!refBgngDe?.trim()) return apiError("VALIDATION_ERROR", "기준 시작 일자를 입력해 주세요.", 400);
  if (!refInfoNm?.trim()) return apiError("VALIDATION_ERROR", "기준 정보 명을 입력해 주세요.", 400);
  if (!busDivCode?.trim()) return apiError("VALIDATION_ERROR", "업무 구분 코드를 선택해 주세요.", 400);
  if (!refDataTyCode?.trim()) return apiError("VALIDATION_ERROR", "자료 유형 코드를 선택해 주세요.", 400);

  try {
    // 중복 체크: 코드 + 시작일 유니크 (전역)
    const dup = await prisma.tbCmReferenceInfo.findUnique({
      where: { ref_info_code_ref_bgng_de: { ref_info_code: refInfoCode.trim(), ref_bgng_de: refBgngDe.trim() } },
    });
    if (dup) {
      return apiError("VALIDATION_ERROR", "동일한 기준 코드 + 시작일이 이미 존재합니다.", 400);
    }

    const created = await prisma.tbCmReferenceInfo.create({
      data: {
        ref_info_code:    refInfoCode.trim(),
        ref_bgng_de:      refBgngDe.trim(),
        ref_end_de:       refEndDe?.trim() || null,
        ref_info_nm:      refInfoNm.trim(),
        bus_div_code:     busDivCode.trim(),
        ref_data_ty_code: refDataTyCode.trim(),
        main_ref_val:     mainRefVal?.trim() || null,
        sub_ref_val:      subRefVal?.trim() || null,
        ref_info_dc:      refInfoDc?.trim() || null,
        creat_mber_id:    auth.mberId,
      },
    });

    return apiSuccess({ refInfoId: created.ref_info_id }, 201);
  } catch (err) {
    console.error("[POST /api/.../reference-info] DB 오류:", err);
    return apiError("DB_ERROR", "기준 정보 생성에 실패했습니다.", 500);
  }
}
