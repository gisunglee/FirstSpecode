/**
 * GET  /api/projects/[id]/col-mapping-groups — 컬럼 매핑 그룹 목록 조회
 * POST /api/projects/[id]/col-mapping-groups — 컬럼 매핑 그룹 생성
 *
 * GET Query: refType (필수), refId (필수)
 * POST Body: { refType, refId, grpNm }
 *
 * refType: 'FUNCTION' | ... (col-mappings 와 동일한 참조 유형)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 그룹 목록 조회 ─────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;
  const url     = new URL(request.url);
  const refType = url.searchParams.get("refType");
  const refId   = url.searchParams.get("refId");

  if (!refType || !refId) {
    return apiError("VALIDATION_ERROR", "refType, refId 파라미터가 필요합니다.", 400);
  }

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const groups = await prisma.tbDsColMappingGroup.findMany({
      where:   { ref_ty_code: refType, ref_id: refId },
      orderBy: { sort_ordr: "asc" },
    });

    return apiSuccess({
      items: groups.map((g) => ({
        grpId:    g.grp_id,
        grpNm:    g.grp_nm,
        sortOrder: g.sort_ordr,
      })),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/col-mapping-groups] DB 오류:`, err);
    return apiError("DB_ERROR", "컬럼 매핑 그룹 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 그룹 생성 ─────────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

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

  const { refType, refId, grpNm } = body as { refType?: string; refId?: string; grpNm?: string };

  if (!refType || !refId) {
    return apiError("VALIDATION_ERROR", "refType, refId 가 필요합니다.", 400);
  }
  if (!grpNm || !grpNm.trim()) {
    return apiError("VALIDATION_ERROR", "그룹 이름이 필요합니다.", 400);
  }

  try {
    // 같은 ref 안에서 가장 큰 sort_ordr 다음 순번으로 추가
    const last = await prisma.tbDsColMappingGroup.findFirst({
      where:   { ref_ty_code: refType, ref_id: refId },
      orderBy: { sort_ordr: "desc" },
      select:  { sort_ordr: true },
    });

    const group = await prisma.tbDsColMappingGroup.create({
      data: {
        ref_ty_code: refType,
        ref_id:      refId,
        grp_nm:      grpNm.trim(),
        sort_ordr:   (last?.sort_ordr ?? 0) + 1,
      },
    });

    return apiSuccess({ grpId: group.grp_id, grpNm: group.grp_nm, sortOrder: group.sort_ordr });
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/col-mapping-groups] DB 오류:`, err);
    return apiError("DB_ERROR", "컬럼 매핑 그룹 생성에 실패했습니다.", 500);
  }
}
