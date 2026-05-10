/**
 * GET  /api/projects/[id]/functions — 기능 목록 조회 (FID-00167)
 * POST /api/projects/[id]/functions — 기능 생성 + 이력 (FID-00172)
 *
 * GET Query: areaId? (선택적 영역 필터)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { getIdPrefix } from "@/lib/idPrefix";
import { fetchProjectFunctions } from "@/lib/exports/functions-data";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 기능 목록 조회 ─────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const url    = new URL(request.url);
  const areaId = url.searchParams.get("areaId") ?? undefined;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    // 데이터 조회+가공 로직은 service 로 분리 — export 라우트와 동일 결과 보장
    const items = await fetchProjectFunctions({ projectId, areaId });
    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/functions] DB 오류:`, err);
    return apiError("DB_ERROR", "기능 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 기능 생성 + 이력 ──────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const {
    areaId, displayId: inputDisplayId, name, type, description, priority, complexity, effort,
    assignMemberId, implStartDate, implEndDate, sortOrder,
  } = body as {
    areaId?:         string;
    displayId?:      string;
    name?:           string;
    type?:           string;
    description?:    string;
    priority?:       string;
    complexity?:     string;
    effort?:         string;
    assignMemberId?: string;
    implStartDate?:  string;
    implEndDate?:    string;
    sortOrder?:      number;
  };

  if (!name?.trim()) return apiError("VALIDATION_ERROR", "기능명을 입력해 주세요.", 400);

  // 시작/종료일 순서 검증
  if (implStartDate && implEndDate && implStartDate > implEndDate) {
    return apiError("VALIDATION_ERROR", "구현 종료일은 시작일 이후여야 합니다.", 400);
  }

  try {
    // displayId — 사용자 입력값이 있으면 사용, 없으면 FN-NNNNN 형식 자동 생성
    let displayId: string;
    if (inputDisplayId?.trim()) {
      displayId = inputDisplayId.trim();
    } else {
      const last = await prisma.tbDsFunction.findFirst({
        where:   { prjct_id: projectId },
        orderBy: { func_display_id: "desc" },
        select:  { func_display_id: true },
      });
      const nextNum = last ? parseInt(last.func_display_id.replace(/\D/g, "")) + 1 : 1;
      const fnPrefix = await getIdPrefix(projectId, "FUNCTION");
      displayId = `${fnPrefix}-${String(nextNum).padStart(5, "0")}`;
    }

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
        sort_ordr:      nextSort,
      },
    });

    await prisma.tbDsDesignChange.create({
      data: {
        prjct_id:      projectId,
        ref_tbl_nm:    "tb_ds_function",
        ref_id:        fn.func_id,
        chg_type_code: "CREATE",
        chg_rsn_cn:    "기능 생성",
        snapshot_data: {
          funcId:    fn.func_id,
          displayId: displayId,
          name:      name.trim(),
          type:      type || "OTHER",
        },
        chg_mber_id: gate.mberId,
      },
    });

    return apiSuccess({ funcId: fn.func_id, displayId }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/functions] DB 오류:`, err);
    return apiError("DB_ERROR", "기능 생성에 실패했습니다.", 500);
  }
}
