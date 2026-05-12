/**
 * GET  /api/projects/[id]/screens — 화면 목록 조회 (FID-00142)
 * POST /api/projects/[id]/screens — 화면 생성 (FID-00147 신규)
 *
 * Query: unitWorkId? — 특정 단위업무 화면만 조회 (없으면 프로젝트 전체)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { getIdPrefix } from "@/lib/idPrefix";
import { apiTextLimitGuard } from "@/lib/constants/textLimits";
import { fetchProjectScreens } from "@/lib/exports/screens-data";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 화면 목록 조회 ─────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const url        = new URL(request.url);
  const unitWorkId = url.searchParams.get("unitWorkId") ?? undefined;
  // 담당자 필터 — "me" 또는 mberId
  const assignedTo = url.searchParams.get("assignedTo") ?? undefined;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const assigneeFilter = assignedTo === "me" ? gate.mberId : (assignedTo || undefined);

  try {
    // 데이터 조회+가공 로직은 service 로 분리 — export 라우트와 동일 결과 보장
    const items = await fetchProjectScreens({ projectId, unitWorkId, assigneeFilter });
    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/screens] DB 오류:`, err);
    return apiError("DB_ERROR", "화면 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 화면 생성 ─────────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { unitWorkId, displayId: inputDisplayId, name, type, categoryL, categoryM, categoryS } = body as {
    unitWorkId?:  string;
    displayId?:   string;
    name?:        string;
    type?:        string;
    categoryL?:   string;
    categoryM?:   string;
    categoryS?:   string;
  };

  if (!name?.trim()) return apiError("VALIDATION_ERROR", "화면명을 입력해 주세요.", 400);

  // 장문 텍스트 한도 검증 — 정책은 src/lib/constants/textLimits.ts
  const limitErr = apiTextLimitGuard([
    ["name",      name],
    ["displayId", inputDisplayId],
  ]);
  if (limitErr) return limitErr;

  // 상위 단위업무가 이 프로젝트에 속하는지 확인 (보안)
  if (unitWorkId) {
    const uw = await prisma.tbDsUnitWork.findUnique({ where: { unit_work_id: unitWorkId } });
    if (!uw || uw.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "단위업무를 찾을 수 없습니다.", 404);
    }
  }

  try {
    // 표시 ID — 사용자 입력값이 있으면 사용, 없으면 자동 채번 (SCR-NNNNN)
    let displayId: string;
    if (inputDisplayId?.trim()) {
      displayId = inputDisplayId.trim();
    } else {
      const maxScr = await prisma.tbDsScreen.findFirst({
        where:   { prjct_id: projectId },
        orderBy: { scrn_display_id: "desc" },
        select:  { scrn_display_id: true },
      });
      const nextSeq = maxScr
        ? (parseInt(maxScr.scrn_display_id.replace(/\D/g, "")) || 0) + 1
        : 1;
      const scrPrefix = await getIdPrefix(projectId, "SCREEN");
      displayId = `${scrPrefix}-${String(nextSeq).padStart(5, "0")}`;
    }

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
        chg_type_code: "CREATE",
        chg_rsn_cn:    "화면 신규 생성",
        snapshot_data: {
          screenId:  screen.scrn_id,
          displayId: screen.scrn_display_id,
          name:      screen.scrn_nm,
          type:      screen.scrn_ty_code,
        },
        chg_mber_id: gate.mberId,
      },
    });

    return apiSuccess({ screenId: screen.scrn_id, displayId: screen.scrn_display_id }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/screens] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}
