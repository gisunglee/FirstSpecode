/**
 * GET  /api/projects/[id]/areas — 영역 목록 조회 (FID-00151)
 * POST /api/projects/[id]/areas — 영역 생성 + 이력 (FID-00154)
 *
 * GET Query: screenId? (선택적 화면 필터)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { getIdPrefix } from "@/lib/idPrefix";
import { fetchProjectAreas } from "@/lib/exports/areas-data";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 영역 목록 조회 ────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const url      = new URL(request.url);
  const screenId = url.searchParams.get("screenId") ?? undefined;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    // 데이터 조회+가공 로직은 service 로 분리 — export 라우트와 동일 결과 보장
    const items = await fetchProjectAreas({ projectId, screenId });
    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/areas] DB 오류:`, err);
    return apiError("DB_ERROR", "영역 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 영역 생성 + 이력 ──────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { screenId, name, type, displayFormCode, description, sortOrder, displayId: inputDisplayId } = body as {
    screenId?:        string;
    name?:            string;
    type?:            string;
    displayFormCode?: string;
    description?:     string;
    sortOrder?:       number;
    displayId?:       string;
  };

  if (!name?.trim()) return apiError("VALIDATION_ERROR", "영역명을 입력해 주세요.", 400);

  try {
    // displayId — 사용자 입력값이 있으면 사용, 없으면 AR-NNNNN 자동 생성
    let displayId: string;
    if (inputDisplayId?.trim()) {
      displayId = inputDisplayId.trim();
    } else {
      const last = await prisma.tbDsArea.findFirst({
        where:   { prjct_id: projectId },
        orderBy: { area_display_id: "desc" },
        select:  { area_display_id: true },
      });
      const nextNum = last ? parseInt(last.area_display_id.replace(/\D/g, "")) + 1 : 1;
      const arPrefix = await getIdPrefix(projectId, "AREA");
      displayId = `${arPrefix}-${String(nextNum).padStart(5, "0")}`;
    }

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
          // 유형 — 미전송 시 LIST(데이터 목록) 기본
          area_ty_code:   type || "LIST",
          // 표시 형태 — 미전송 시 STATIC(고정) 기본
          display_form_code: displayFormCode || "STATIC",
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
          type:      type || "LIST",
        },
        chg_mber_id: gate.mberId,
      },
    });

    return apiSuccess({ areaId: area.area_id, displayId }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/areas] DB 오류:`, err);
    return apiError("DB_ERROR", "영역 생성에 실패했습니다.", 500);
  }
}
