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
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; screenId: string }> };

// ─── GET: 화면 상세 조회 ─────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, screenId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    const screen = await prisma.tbDsScreen.findUnique({
      where:   { scrn_id: screenId },
      include: {
        unitWork: { select: { unit_work_id: true, unit_work_display_id: true, unit_work_nm: true } },
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

    // 담당자 이름 조회 — 없거나 퇴장 멤버면 null
    const assignee = screen.asign_mber_id
      ? await prisma.tbCmMember.findUnique({
          where:  { mber_id: screen.asign_mber_id },
          // email_addr를 fallback으로 — mber_nm 미설정 계정도 식별 가능
          select: { mber_nm: true, email_addr: true },
        })
      : null;

    // 영역별 진척률 집계 — 영역 → 기능 → tb_cm_progress
    const areaIds = screen.areas.map(a => a.area_id);
    let progMap = new Map<string, { designRt: number; implRt: number; testRt: number }>();
    if (areaIds.length > 0) {
      const aggRows = await prisma.$queryRaw<{
        area_id: string; avg_design_rt: number; avg_impl_rt: number; avg_test_rt: number;
      }[]>`
        SELECT f.area_id,
               COALESCE(AVG(p.design_rt), 0) AS avg_design_rt,
               COALESCE(AVG(p.impl_rt),   0) AS avg_impl_rt,
               COALESCE(AVG(p.test_rt),   0) AS avg_test_rt
          FROM tb_ds_function f
          LEFT JOIN tb_cm_progress p
            ON p.ref_tbl_nm = 'tb_ds_function' AND p.ref_id = f.func_id
         WHERE f.area_id IN (${Prisma.join(areaIds)})
         GROUP BY f.area_id
      `;
      progMap = new Map(aggRows.map(r => [r.area_id, {
        designRt: Math.round(Number(r.avg_design_rt)),
        implRt:   Math.round(Number(r.avg_impl_rt)),
        testRt:   Math.round(Number(r.avg_test_rt)),
      }]));
    }

    return apiSuccess({
      screenId:         screen.scrn_id,
      displayId:        screen.scrn_display_id,
      name:             screen.scrn_nm,
      description:      screen.scrn_dc ?? "",
      layoutData:       screen.layer_data_dc ?? null,
      type:             screen.scrn_ty_code,
      categoryL:        screen.ctgry_l_nm ?? "",
      categoryM:        screen.ctgry_m_nm ?? "",
      categoryS:        screen.ctgry_s_nm ?? "",
      comment:          screen.coment_cn ?? "",
      urlPath:          screen.url_path ?? "",
      sortOrder:        screen.sort_ordr,
      // 담당자 — mber_nm 우선, 없으면 email, 둘 다 없으면 null (퇴장 멤버 포함)
      assignMemberId:   screen.asign_mber_id ?? null,
      assignMemberName: assignee ? (assignee.mber_nm || assignee.email_addr || null) : null,
      unitWorkId:        screen.unit_work_id ?? null,
      unitWorkDisplayId: screen.unitWork?.unit_work_display_id ?? null,
      unitWorkName:      screen.unitWork?.unit_work_nm ?? "미분류",
      areas: screen.areas.map((a) => {
        const prog = progMap.get(a.area_id);
        return {
          areaId:    a.area_id,
          displayId: a.area_display_id,
          name:      a.area_nm,
          type:      a.area_ty_code,
          sortOrder: a.sort_ordr,
          designRt:  prog?.designRt ?? 0,
          implRt:    prog?.implRt ?? 0,
          testRt:    prog?.testRt ?? 0,
        };
      }),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/screens/${screenId}] DB 오류:`, err);
    return apiError("DB_ERROR", "화면 조회에 실패했습니다.", 500);
  }
}

// ─── PUT: 화면 수정 + 이력 ───────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, screenId } = await params;

  const gate = await requirePermission(request, projectId, "content.update");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { unitWorkId, displayId, name, description, comment, type, sortOrder, categoryL, categoryM, categoryS, layoutData, saveHistory, assignMemberId } = body as {
    unitWorkId?:     string;
    displayId?:      string;
    name?:           string;
    description?:    string;
    comment?:        string;
    type?:           string;
    sortOrder?:      number;
    categoryL?:      string;
    categoryM?:      string;
    categoryS?:      string;
    layoutData?:     string;
    saveHistory?:    boolean;
    assignMemberId?: string;
  };

  if (!name?.trim()) return apiError("VALIDATION_ERROR", "화면명을 입력해 주세요.", 400);

  try {
    const existing = await prisma.tbDsScreen.findUnique({ where: { scrn_id: screenId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "화면을 찾을 수 없습니다.", 404);
    }

    const newDescription = description?.trim() || null;
    const oldDescription = existing.scrn_dc ?? null;

    // 담당자 변경 감지 — 값이 실제로 바뀌었을 때만 이력 저장 (no-op 스킵)
    // SettingsHistoryDialog의 itemName="담당자"와 정확히 일치해야 필터됨
    const CHG_REASON_ASSIGNEE = "담당자";
    const prevAssignee    = existing.asign_mber_id ?? null;
    const nextAssignee    = assignMemberId !== undefined ? (assignMemberId || null) : prevAssignee;
    const assigneeChanged = assignMemberId !== undefined && prevAssignee !== nextAssignee;

    // 이력 저장 시 이름도 함께 기록 → 멤버 탈퇴 후에도 이력 뷰 보존
    let assigneeNames: { before: string | null; after: string | null } = { before: null, after: null };
    if (assigneeChanged) {
      const ids = [prevAssignee, nextAssignee].filter((v): v is string => !!v);
      const membersForHistory = ids.length > 0
        ? await prisma.tbCmMember.findMany({
            where:  { mber_id: { in: ids } },
            // email_addr를 fallback으로 — mber_nm 미설정 계정도 이력에서 식별 가능
            select: { mber_id: true, mber_nm: true, email_addr: true },
          })
        : [];
      const nameMap = new Map(membersForHistory.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null]));
      assigneeNames = {
        before: prevAssignee ? (nameMap.get(prevAssignee) ?? null) : null,
        after:  nextAssignee ? (nameMap.get(nextAssignee) ?? null) : null,
      };
    }

    await prisma.$transaction([
      prisma.tbDsScreen.update({
        where: { scrn_id: screenId },
        data:  {
          unit_work_id:    unitWorkId !== undefined ? (unitWorkId || null) : existing.unit_work_id,
          scrn_display_id: displayId?.trim() || existing.scrn_display_id,
          scrn_nm:         name?.trim() || existing.scrn_nm,
          scrn_dc:       description !== undefined ? newDescription : existing.scrn_dc,
          coment_cn:     comment !== undefined ? (comment?.trim() || null) : existing.coment_cn,
          layer_data_dc: layoutData !== undefined ? (layoutData ?? null) : existing.layer_data_dc,
          scrn_ty_code:  type || existing.scrn_ty_code,
          sort_ordr:     sortOrder ?? existing.sort_ordr,
          ctgry_l_nm:    categoryL !== undefined ? (categoryL?.trim() || null) : existing.ctgry_l_nm,
          ctgry_m_nm:    categoryM !== undefined ? (categoryM?.trim() || null) : existing.ctgry_m_nm,
          ctgry_s_nm:    categoryS !== undefined ? (categoryS?.trim() || null) : existing.ctgry_s_nm,
          asign_mber_id: nextAssignee,
          mdfcn_dt:      new Date(),
        },
      }),
      // 설계 변경 이력 자동 기록 (FID-00147 v3 정책)
      prisma.tbDsDesignChange.create({
        data: {
          prjct_id:      projectId,
          ref_tbl_nm:    "tb_ds_screen",
          ref_id:        screenId,
          chg_type_code: "UPDATE",
          chg_rsn_cn:    "화면 수정",
          snapshot_data: {
            screenId:  screenId,
            displayId: displayId?.trim() || existing.scrn_display_id,
            name:      name.trim(),
            type:      type || "LIST",
            categoryL: categoryL?.trim() || null,
          },
          chg_mber_id: gate.mberId,
        },
      }),
      // 설명 변경 이력 — tb_ds_design_change에 before/after JSON으로 저장
      ...(saveHistory ? [
        prisma.tbDsDesignChange.create({
          data: {
            prjct_id:      projectId,
            ref_tbl_nm:    "tb_ds_screen",
            ref_id:        screenId,
            chg_type_code: "UPDATE",
            chg_rsn_cn:    "화면 설명",
            snapshot_data: {
              before: oldDescription,
              after:  newDescription,
            },
            chg_mber_id: gate.mberId,
          },
        }),
      ] : []),
      // 담당자 변경 이력 — 자동 저장 (값이 실제로 바뀐 경우만)
      // snapshot에 ID+이름 동반 저장 → 멤버 탈퇴 후에도 이력 뷰 보존
      ...(assigneeChanged ? [
        prisma.tbDsDesignChange.create({
          data: {
            prjct_id:      projectId,
            ref_tbl_nm:    "tb_ds_screen",
            ref_id:        screenId,
            chg_type_code: "UPDATE",
            chg_rsn_cn:    CHG_REASON_ASSIGNEE,
            snapshot_data: {
              before:     prevAssignee,
              after:      nextAssignee,
              beforeName: assigneeNames.before,
              afterName:  assigneeNames.after,
            },
            chg_mber_id: gate.mberId,
          },
        }),
      ] : []),
    ]);

    return apiSuccess({ screenId });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/screens/${screenId}] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}

// ─── DELETE: 화면 삭제 + 이력 ───────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, screenId } = await params;
  const url            = new URL(request.url);
  const deleteChildren = url.searchParams.get("deleteChildren") !== "false"; // 기본 true

  const gate = await requirePermission(request, projectId, "content.delete");
  if (gate instanceof Response) return gate;

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
            chg_type_code: "DELETE",
            chg_rsn_cn:    "화면 삭제",
            snapshot_data: {
              screenId:  screenId,
              displayId: existing.scrn_display_id,
              name:      existing.scrn_nm,
              deletedAt: new Date().toISOString(),
            },
            chg_mber_id: gate.mberId,
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
            chg_type_code: "DELETE",
            chg_rsn_cn:    "화면 삭제 (영역 미분류 유지)",
            snapshot_data: {
              screenId:  screenId,
              displayId: existing.scrn_display_id,
              name:      existing.scrn_nm,
              deletedAt: new Date().toISOString(),
            },
            chg_mber_id: gate.mberId,
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
