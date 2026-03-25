/**
 * GET    /api/projects/[id]/screens/[screenId] — 화면 상세 조회 (FID-00146)
 * PUT    /api/projects/[id]/screens/[screenId] — 화면 수정 + 이력 (FID-00147 수정)
 * DELETE /api/projects/[id]/screens/[screenId] — 화면 삭제 + 이력 (FID-00150)
 *
 * DELETE Query: deleteChildren=true|false (기본 true)
 *   - true:  하위 영역·기능 전체 삭제
 *   - false: 화면만 삭제 (영역의 scrn_id NULL 처리)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; screenId: string }> };

// ─── GET: 화면 상세 조회 ─────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, screenId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const screen = await prisma.tbDsScreen.findUnique({
      where:   { scrn_id: screenId },
      include: {
        unitWork: { select: { unit_work_id: true, unit_work_nm: true } },
        // 하단 영역 목록 (AR-00066, FID-00148) — sort_ordr 오름차순
        areas: {
          orderBy: { sort_ordr: "asc" },
          select: {
            area_id:         true,
            area_display_id: true,
            area_nm:         true,
            area_ty_code:    true,
            sort_ordr:       true,
          },
        },
      },
    });

    if (!screen || screen.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "화면을 찾을 수 없습니다.", 404);
    }

    return apiSuccess({
      screenId:     screen.scrn_id,
      displayId:    screen.scrn_display_id,
      name:         screen.scrn_nm,
      description:  screen.scrn_dc ?? "",
      displayCode:  screen.dsply_code ?? "",
      type:         screen.scrn_ty_code,
      categoryL:    screen.ctgry_l_nm ?? "",
      categoryM:    screen.ctgry_m_nm ?? "",
      categoryS:    screen.ctgry_s_nm ?? "",
      urlPath:      screen.url_path ?? "",
      sortOrder:    screen.sort_ordr,
      unitWorkId:   screen.unit_work_id ?? null,
      unitWorkName: screen.unitWork?.unit_work_nm ?? "미분류",
      areas: screen.areas.map((a) => ({
        areaId:    a.area_id,
        displayId: a.area_display_id,
        name:      a.area_nm,
        type:      a.area_ty_code,
        sortOrder: a.sort_ordr,
      })),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/screens/${screenId}] DB 오류:`, err);
    return apiError("DB_ERROR", "화면 조회에 실패했습니다.", 500);
  }
}

// ─── PUT: 화면 수정 + 이력 ───────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, screenId } = await params;

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

  try {
    const existing = await prisma.tbDsScreen.findUnique({ where: { scrn_id: screenId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "화면을 찾을 수 없습니다.", 404);
    }

    // 수정 + 설계 변경 이력 (트랜잭션)
    await prisma.$transaction([
      prisma.tbDsScreen.update({
        where: { scrn_id: screenId },
        data:  {
          unit_work_id: unitWorkId || null,
          scrn_nm:      name.trim(),
          dsply_code:   displayCode?.trim() || null,
          scrn_ty_code: type || "LIST",
          ctgry_l_nm:   categoryL?.trim() || null,
          ctgry_m_nm:   categoryM?.trim() || null,
          ctgry_s_nm:   categoryS?.trim() || null,
          mdfcn_dt:     new Date(),
        },
      }),
      // 설계 변경 이력 자동 기록 (FID-00147 v3 정책)
      prisma.tbDsDesignChange.create({
        data: {
          prjct_id:      projectId,
          ref_tbl_nm:    "tb_ds_screen",
          ref_id:        screenId,
          chg_rsn_cn:    "화면 수정",
          snapshot_data: {
            screenId:    screenId,
            displayId:   existing.scrn_display_id,
            name:        name.trim(),
            type:        type || "LIST",
            displayCode: displayCode?.trim() || null,
            categoryL:   categoryL?.trim() || null,
          },
          chg_mber_id: auth.mberId,
        },
      }),
    ]);

    return apiSuccess({ screenId });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/screens/${screenId}] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}

// ─── DELETE: 화면 삭제 + 이력 ───────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, screenId } = await params;
  const url            = new URL(request.url);
  const deleteChildren = url.searchParams.get("deleteChildren") !== "false"; // 기본 true

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  try {
    const existing = await prisma.tbDsScreen.findUnique({ where: { scrn_id: screenId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "화면을 찾을 수 없습니다.", 404);
    }

    if (deleteChildren) {
      // 하위 영역 전체 삭제 후 화면 삭제 + 이력 기록
      await prisma.$transaction([
        prisma.tbDsArea.deleteMany({ where: { scrn_id: screenId } }),
        prisma.tbDsScreen.delete({ where: { scrn_id: screenId } }),
        prisma.tbDsDesignChange.create({
          data: {
            prjct_id:      projectId,
            ref_tbl_nm:    "tb_ds_screen",
            ref_id:        screenId,
            chg_rsn_cn:    "화면 삭제",
            snapshot_data: {
              screenId:  screenId,
              displayId: existing.scrn_display_id,
              name:      existing.scrn_nm,
              deletedAt: new Date().toISOString(),
            },
            chg_mber_id: auth.mberId,
          },
        }),
      ]);
    } else {
      // 영역의 scrn_id NULL 처리 (미분류) 후 화면만 삭제 + 이력 기록
      await prisma.$transaction([
        prisma.tbDsArea.updateMany({
          where: { scrn_id: screenId },
          data:  { scrn_id: null },
        }),
        prisma.tbDsScreen.delete({ where: { scrn_id: screenId } }),
        prisma.tbDsDesignChange.create({
          data: {
            prjct_id:      projectId,
            ref_tbl_nm:    "tb_ds_screen",
            ref_id:        screenId,
            chg_rsn_cn:    "화면 삭제 (영역 미분류 유지)",
            snapshot_data: {
              screenId:  screenId,
              displayId: existing.scrn_display_id,
              name:      existing.scrn_nm,
              deletedAt: new Date().toISOString(),
            },
            chg_mber_id: auth.mberId,
          },
        }),
      ]);
    }

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/screens/${screenId}] DB 오류:`, err);
    return apiError("DB_ERROR", "삭제 중 오류가 발생했습니다.", 500);
  }
}
