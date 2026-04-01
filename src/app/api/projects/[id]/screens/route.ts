/**
 * GET  /api/projects/[id]/screens — 화면 목록 조회 (FID-00142)
 * POST /api/projects/[id]/screens — 화면 생성 (FID-00147 신규)
 *
 * Query: unitWorkId? — 특정 단위업무 화면만 조회 (없으면 프로젝트 전체)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 화면 목록 조회 ─────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;
  const url        = new URL(request.url);
  const unitWorkId = url.searchParams.get("unitWorkId") ?? undefined;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const screens = await prisma.tbDsScreen.findMany({
      where: {
        prjct_id: projectId,
        ...(unitWorkId ? { unit_work_id: unitWorkId } : {}),
      },
      include: {
        unitWork: {
          select: {
            unit_work_id: true,
            unit_work_nm: true,
            requirement: {
              select: {
                req_id: true,
                req_nm: true,
                req_display_id: true,
              },
            },
          },
        },
        // 하위 영역 수 집계
        _count: { select: { areas: true } },
      },
      orderBy: [
        { unitWork: { requirement: { sort_ordr: "asc" } } },  // 요구사항 정렬순서
        { unitWork: { sort_ordr: "asc" } },                    // 단위업무 정렬순서
        { sort_ordr: "asc" },                                  // 화면 정렬순서
      ],
    });

    const items = screens.map((s) => ({
      screenId:        s.scrn_id,
      displayId:       s.scrn_display_id,
      name:            s.scrn_nm,
      type:            s.scrn_ty_code,
      categoryL:       s.ctgry_l_nm ?? "",
      categoryM:       s.ctgry_m_nm ?? "",
      categoryS:       s.ctgry_s_nm ?? "",
      unitWorkId:      s.unit_work_id ?? null,
      unitWorkName:    s.unitWork?.unit_work_nm ?? "미분류",
      requirementId:   s.unitWork?.requirement?.req_id ?? null,
      requirementName: s.unitWork?.requirement
        ? `[${s.unitWork.requirement.req_display_id}] ${s.unitWork.requirement.req_nm}`
        : "미분류",
      areaCount:       s._count.areas,
      sortOrder:       s.sort_ordr,
    }));

    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/screens] DB 오류:`, err);
    return apiError("DB_ERROR", "화면 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 화면 생성 ─────────────────────────────────────────────────────────
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

  const { unitWorkId, name, displayCode, type, categoryL, categoryM, categoryS } = body as {
    unitWorkId?:  string;
    name?:        string;
    displayCode?: string;
    type?:        string;
    categoryL?:   string;
    categoryM?:   string;
    categoryS?:   string;
  };

  if (!name?.trim()) return apiError("VALIDATION_ERROR", "화면명을 입력해 주세요.", 400);

  // 상위 단위업무가 이 프로젝트에 속하는지 확인 (보안)
  if (unitWorkId) {
    const uw = await prisma.tbDsUnitWork.findUnique({ where: { unit_work_id: unitWorkId } });
    if (!uw || uw.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "단위업무를 찾을 수 없습니다.", 404);
    }
  }

  try {
    // 표시 ID 채번 (SCR-NNNNN)
    const maxScr = await prisma.tbDsScreen.findFirst({
      where:   { prjct_id: projectId },
      orderBy: { scrn_display_id: "desc" },
      select:  { scrn_display_id: true },
    });
    const nextSeq = maxScr
      ? (parseInt(maxScr.scrn_display_id.replace(/\D/g, "")) || 0) + 1
      : 1;
    const displayId = `SCR-${String(nextSeq).padStart(5, "0")}`;

    // sort_ordr: 전체 마지막 + 1
    const maxSort = await prisma.tbDsScreen.findFirst({
      where:   { prjct_id: projectId },
      orderBy: { sort_ordr: "desc" },
      select:  { sort_ordr: true },
    });

    const screen = await prisma.tbDsScreen.create({
      data: {
        prjct_id:        projectId,
        unit_work_id:    unitWorkId || null,
        scrn_display_id: displayId,
        scrn_nm:         name.trim(),
        dsply_code:      displayCode?.trim() || null,
        scrn_ty_code:    type || "LIST",
        ctgry_l_nm:      categoryL?.trim() || null,
        ctgry_m_nm:      categoryM?.trim() || null,
        ctgry_s_nm:      categoryS?.trim() || null,
        sort_ordr:       (maxSort?.sort_ordr ?? 0) + 1,
      },
    });

    // 설계 변경 이력 자동 기록 (FID-00147 v3 정책)
    await prisma.tbDsDesignChange.create({
      data: {
        prjct_id:      projectId,
        ref_tbl_nm:    "tb_ds_screen",
        ref_id:        screen.scrn_id,
        chg_rsn_cn:    "화면 신규 생성",
        snapshot_data: {
          screenId:  screen.scrn_id,
          displayId: screen.scrn_display_id,
          name:      screen.scrn_nm,
          type:      screen.scrn_ty_code,
        },
        chg_mber_id: auth.mberId,
      },
    });

    return apiSuccess({ screenId: screen.scrn_id, displayId: screen.scrn_display_id }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/screens] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}
