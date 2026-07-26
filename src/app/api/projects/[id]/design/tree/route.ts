/**
 * GET /api/projects/[id]/design/tree — 설계 트리 배치 조회 (지정 단위업무만)
 *
 * 단위업무 → 화면 → 영역 → 기능 계층을 unitWorkIds로 지정된 단위업무들에 한해 반환한다.
 * 프로젝트 전체를 한 번에 내려주는 엔드포인트는 의도적으로 두지 않는다 — 단위업무가
 * 수백 개로 늘어날 수 있는 프로젝트에서 "전체 점검" 같은 무제한 조회를 허용하면
 * 응답 payload와 호출자(AI) 컨텍스트가 한 번에 소진되기 때문. 대신 최대
 * MAX_UNIT_WORK_IDS개까지만 배치로 받고, 더 넓은 범위는 여러 번 나눠 호출하도록 강제한다.
 *
 * Query: unitWorkIds (필수) — 콤마로 구분된 단위업무 ID 목록, 1~20개
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// 안전장치 — 이 값을 넘기면 "전체 점검" 요청도 에러로 거부된다
const MAX_UNIT_WORK_IDS = 20;

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const url = new URL(request.url);
  const rawIds = url.searchParams.get("unitWorkIds") ?? "";
  const unitWorkIds = rawIds.split(",").map((v) => v.trim()).filter(Boolean);

  if (unitWorkIds.length === 0) {
    return apiError(
      "VALIDATION_ERROR",
      `unitWorkIds가 필요합니다 (콤마로 구분, 최대 ${MAX_UNIT_WORK_IDS}개). "전체 점검"은 지원하지 않으며, list_unit_works로 조회한 ID를 지정해 나눠서 호출해야 합니다.`,
      400
    );
  }
  if (unitWorkIds.length > MAX_UNIT_WORK_IDS) {
    return apiError(
      "VALIDATION_ERROR",
      `한 번에 최대 ${MAX_UNIT_WORK_IDS}개의 단위업무만 조회할 수 있습니다 (요청: ${unitWorkIds.length}개). 여러 배치로 나눠서 호출하세요.`,
      400
    );
  }

  try {
    // 요청된 ID 중 이 프로젝트 소속인 것만 조회 (보안: 타 프로젝트 단위업무 조회 차단)
    const unitWorks = await prisma.tbDsUnitWork.findMany({
      where: { prjct_id: projectId, unit_work_id: { in: unitWorkIds } },
      orderBy: { sort_ordr: "asc" },
      select: {
        unit_work_id: true, unit_work_display_id: true, unit_work_nm: true,
        unit_work_dc: true, req_id: true, sort_ordr: true,
      },
    });

    const foundIds = unitWorks.map((u) => u.unit_work_id);
    const notFoundIds = unitWorkIds.filter((id) => !foundIds.includes(id));

    const screens = await prisma.tbDsScreen.findMany({
      where: { prjct_id: projectId, unit_work_id: { in: foundIds } },
      orderBy: { sort_ordr: "asc" },
      select: {
        scrn_id: true, scrn_display_id: true, scrn_nm: true, scrn_dc: true,
        scrn_ty_code: true, unit_work_id: true, sort_ordr: true,
      },
    });
    const screenIds = screens.map((s) => s.scrn_id);

    const areas = await prisma.tbDsArea.findMany({
      where: { prjct_id: projectId, scrn_id: { in: screenIds } },
      orderBy: { sort_ordr: "asc" },
      select: {
        area_id: true, area_display_id: true, area_nm: true, area_dc: true,
        area_ty_code: true, scrn_id: true, sort_ordr: true,
      },
    });
    const areaIds = areas.map((a) => a.area_id);

    const functions = await prisma.tbDsFunction.findMany({
      where: { prjct_id: projectId, area_id: { in: areaIds } },
      orderBy: { sort_ordr: "asc" },
      select: {
        func_id: true, func_display_id: true, func_nm: true, func_dc: true,
        func_ty_code: true, area_id: true, sort_ordr: true,
      },
    });

    const funcsByArea = new Map<string, typeof functions>();
    for (const f of functions) {
      if (!f.area_id) continue;
      if (!funcsByArea.has(f.area_id)) funcsByArea.set(f.area_id, []);
      funcsByArea.get(f.area_id)!.push(f);
    }

    const areasByScreen = new Map<string, typeof areas>();
    for (const a of areas) {
      if (!a.scrn_id) continue;
      if (!areasByScreen.has(a.scrn_id)) areasByScreen.set(a.scrn_id, []);
      areasByScreen.get(a.scrn_id)!.push(a);
    }

    const screensByUnitWork = new Map<string, typeof screens>();
    for (const s of screens) {
      if (!s.unit_work_id) continue;
      if (!screensByUnitWork.has(s.unit_work_id)) screensByUnitWork.set(s.unit_work_id, []);
      screensByUnitWork.get(s.unit_work_id)!.push(s);
    }

    const unitWorkNodes = unitWorks.map((u) => ({
      unitWorkId: u.unit_work_id,
      displayId: u.unit_work_display_id,
      name: u.unit_work_nm,
      description: u.unit_work_dc,
      reqId: u.req_id,
      screens: (screensByUnitWork.get(u.unit_work_id) ?? []).map((s) => ({
        screenId: s.scrn_id,
        displayId: s.scrn_display_id,
        name: s.scrn_nm,
        description: s.scrn_dc,
        type: s.scrn_ty_code,
        areas: (areasByScreen.get(s.scrn_id) ?? []).map((a) => ({
          areaId: a.area_id,
          displayId: a.area_display_id,
          name: a.area_nm,
          description: a.area_dc,
          type: a.area_ty_code,
          functions: (funcsByArea.get(a.area_id) ?? []).map((f) => ({
            functionId: f.func_id,
            displayId: f.func_display_id,
            name: f.func_nm,
            description: f.func_dc,
            type: f.func_ty_code,
          })),
        })),
      })),
    }));

    return apiSuccess({
      unitWorks: unitWorkNodes,
      requestedCount: unitWorkIds.length,
      foundCount: unitWorks.length,
      notFoundIds,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/design/tree] DB 오류:`, err);
    return apiError("DB_ERROR", "설계 트리 조회에 실패했습니다.", 500);
  }
}
