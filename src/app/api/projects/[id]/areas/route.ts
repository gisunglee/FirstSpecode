/**
 * GET  /api/projects/[id]/areas — 영역 목록 조회 (FID-00151)
 * POST /api/projects/[id]/areas — 영역 생성 + 이력 (FID-00154)
 *
 * GET Query: screenId? (선택적 화면 필터)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 영역 목록 조회 ────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;
  const url      = new URL(request.url);
  const screenId = url.searchParams.get("screenId") ?? undefined;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const areas = await prisma.tbDsArea.findMany({
      where: {
        prjct_id: projectId,
        // screenId가 지정되면 해당 화면 영역만, 아니면 전체
        ...(screenId ? { scrn_id: screenId } : {}),
      },
      orderBy: [
        { screen: { unitWork: { sort_ordr: "asc" } } },  // 단위업무 정렬순서
        { screen: { sort_ordr: "asc" } },                  // 화면 정렬순서
        { sort_ordr: "asc" },                              // 영역 정렬순서
      ],
      include: {
        screen: {
          select: {
            scrn_id:         true,
            scrn_nm:         true,
            scrn_display_id: true,
            sort_ordr:       true,
            unitWork: {
              select: {
                unit_work_id:  true,
                unit_work_nm:  true,
                sort_ordr:     true,
              },
            },
          },
        },
        _count: { select: { functions: true } },
      },
    });

    const items = areas.map((a) => ({
      areaId:          a.area_id,
      displayId:       a.area_display_id,
      name:            a.area_nm,
      type:            a.area_ty_code,
      sortOrder:       a.sort_ordr,
      screenId:        a.scrn_id ?? null,
      screenName:      a.screen?.scrn_nm ?? "미분류",
      screenDisplayId: a.screen?.scrn_display_id ?? null,
      unitWorkId:      a.screen?.unitWork?.unit_work_id ?? null,
      unitWorkName:    a.screen?.unitWork?.unit_work_nm ?? null,
      functionCount:   a._count.functions,
    }));

    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/areas] DB 오류:`, err);
    return apiError("DB_ERROR", "영역 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 영역 생성 + 이력 ──────────────────────────────────────────────────
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

  const { screenId, name, type, description, sortOrder } = body as {
    screenId?:    string;
    name?:        string;
    type?:        string;
    description?: string;
    sortOrder?:   number;
  };

  if (!name?.trim()) return apiError("VALIDATION_ERROR", "영역명을 입력해 주세요.", 400);

  try {
    // AR-NNNNN 형식 displayId 생성 — 프로젝트 내 마지막 번호 + 1
    const last = await prisma.tbDsArea.findFirst({
      where:   { prjct_id: projectId },
      orderBy: { area_display_id: "desc" },
      select:  { area_display_id: true },
    });
    const nextNum    = last ? parseInt(last.area_display_id.replace(/\D/g, "")) + 1 : 1;
    const displayId  = `AR-${String(nextNum).padStart(5, "0")}`;

    // 정렬순서 기본값: 현재 최대 + 1
    const maxSort = await prisma.tbDsArea.aggregate({
      where: { prjct_id: projectId },
      _max:  { sort_ordr: true },
    });
    const nextSort = sortOrder ?? (maxSort._max.sort_ordr ?? 0) + 1;

    const [area] = await prisma.$transaction([
      prisma.tbDsArea.create({
        data: {
          prjct_id:       projectId,
          scrn_id:        screenId || null,
          area_display_id: displayId,
          area_nm:        name.trim(),
          area_ty_code:   type || "GRID",
          area_dc:        description?.trim() || null,
          sort_ordr:      nextSort,
        },
      }),
      // 설계 변경 이력은 create 후 areaId가 있어야 하므로 별도 처리
    ]);

    // 생성 이력 기록 (트랜잭션 외부 — create 결과 areaId 필요)
    await prisma.tbDsDesignChange.create({
      data: {
        prjct_id:      projectId,
        ref_tbl_nm:    "tb_ds_area",
        ref_id:        area.area_id,
        chg_type_code: "CREATE",
        chg_rsn_cn:    "영역 생성",
        snapshot_data: {
          areaId:    area.area_id,
          displayId: displayId,
          name:      name.trim(),
          type:      type || "GRID",
        },
        chg_mber_id: auth.mberId,
      },
    });

    return apiSuccess({ areaId: area.area_id, displayId }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/areas] DB 오류:`, err);
    return apiError("DB_ERROR", "영역 생성에 실패했습니다.", 500);
  }
}
