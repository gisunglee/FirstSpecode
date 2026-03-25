/**
 * GET  /api/projects/[id]/functions — 기능 목록 조회 (FID-00167)
 * POST /api/projects/[id]/functions — 기능 생성 + 이력 (FID-00172)
 *
 * GET Query: areaId? (선택적 영역 필터)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 기능 목록 조회 ─────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;
  const url    = new URL(request.url);
  const areaId = url.searchParams.get("areaId") ?? undefined;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const functions = await prisma.tbDsFunction.findMany({
      where: {
        prjct_id: projectId,
        ...(areaId ? { area_id: areaId } : {}),
      },
      orderBy: { sort_ordr: "asc" },
      include: {
        area: { select: { area_id: true, area_nm: true, area_display_id: true } },
      },
    });

    const items = functions.map((f) => ({
      funcId:    f.func_id,
      displayId: f.func_display_id,
      name:      f.func_nm,
      type:      f.func_ty_code,
      status:    f.func_sttus_code,
      priority:  f.priort_code,
      complexity: f.cmplx_code,
      effort:    f.efrt_val ?? "",
      sortOrder: f.sort_ordr,
      areaId:    f.area_id ?? null,
      areaName:  f.area?.area_nm ?? "미분류",
      areaDisplayId: f.area?.area_display_id ?? null,
    }));

    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/functions] DB 오류:`, err);
    return apiError("DB_ERROR", "기능 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 기능 생성 + 이력 ──────────────────────────────────────────────────
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
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const {
    areaId, name, type, description, priority, complexity, effort,
    assignMemberId, implStartDate, implEndDate, spec, sortOrder,
  } = body as {
    areaId?:         string;
    name?:           string;
    type?:           string;
    description?:    string;
    priority?:       string;
    complexity?:     string;
    effort?:         string;
    assignMemberId?: string;
    implStartDate?:  string;
    implEndDate?:    string;
    spec?:           string;
    sortOrder?:      number;
  };

  if (!name?.trim()) return apiError("VALIDATION_ERROR", "기능명을 입력해 주세요.", 400);

  // 시작/종료일 순서 검증
  if (implStartDate && implEndDate && implStartDate > implEndDate) {
    return apiError("VALIDATION_ERROR", "구현 종료일은 시작일 이후여야 합니다.", 400);
  }

  try {
    // FN-NNNNN 형식 displayId 생성
    const last = await prisma.tbDsFunction.findFirst({
      where:   { prjct_id: projectId },
      orderBy: { func_display_id: "desc" },
      select:  { func_display_id: true },
    });
    const nextNum   = last ? parseInt(last.func_display_id.replace(/\D/g, "")) + 1 : 1;
    const displayId = `FN-${String(nextNum).padStart(5, "0")}`;

    const maxSort = await prisma.tbDsFunction.aggregate({
      where: { prjct_id: projectId },
      _max:  { sort_ordr: true },
    });
    const nextSort = sortOrder ?? (maxSort._max.sort_ordr ?? 0) + 1;

    const fn = await prisma.tbDsFunction.create({
      data: {
        prjct_id:       projectId,
        area_id:        areaId || null,
        func_display_id: displayId,
        func_nm:        name.trim(),
        func_ty_code:   type || "OTHER",
        func_dc:        description?.trim() || null,
        priort_code:    priority || "MEDIUM",
        cmplx_code:     complexity || "MEDIUM",
        efrt_val:       effort?.trim() || null,
        asign_mber_id:  assignMemberId || null,
        impl_bgng_de:   implStartDate || null,
        impl_end_de:    implEndDate || null,
        spec_cn:        spec?.trim() || null,
        sort_ordr:      nextSort,
      },
    });

    await prisma.tbDsDesignChange.create({
      data: {
        prjct_id:      projectId,
        ref_tbl_nm:    "tb_ds_function",
        ref_id:        fn.func_id,
        chg_rsn_cn:    "기능 생성",
        snapshot_data: {
          funcId:    fn.func_id,
          displayId: displayId,
          name:      name.trim(),
          type:      type || "OTHER",
        },
        chg_mber_id: auth.mberId,
      },
    });

    return apiSuccess({ funcId: fn.func_id, displayId }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/functions] DB 오류:`, err);
    return apiError("DB_ERROR", "기능 생성에 실패했습니다.", 500);
  }
}
