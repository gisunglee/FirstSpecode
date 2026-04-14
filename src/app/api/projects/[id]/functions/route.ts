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
      include: {
        area: {
          select: {
            area_id:         true,
            area_nm:         true,
            area_display_id: true,
            sort_ordr:       true,
            screen: {
              select: {
                scrn_id:         true,
                scrn_nm:         true,
                scrn_display_id: true,
                sort_ordr:       true,
                ctgry_l_nm:      true,
                ctgry_m_nm:      true,
                ctgry_s_nm:      true,
                unitWork: {
                  select: {
                    unit_work_id: true,
                    unit_work_nm: true,
                    sort_ordr:    true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // 단위업무 → 화면 → 영역 → 기능 정렬순서로 정렬
    functions.sort((a, b) => {
      const uwA = a.area?.screen?.unitWork?.sort_ordr ?? 9999;
      const uwB = b.area?.screen?.unitWork?.sort_ordr ?? 9999;
      if (uwA !== uwB) return uwA - uwB;
      const scA = a.area?.screen?.sort_ordr ?? 9999;
      const scB = b.area?.screen?.sort_ordr ?? 9999;
      if (scA !== scB) return scA - scB;
      const arA = a.area?.sort_ordr ?? 9999;
      const arB = b.area?.sort_ordr ?? 9999;
      if (arA !== arB) return arA - arB;
      return a.sort_ordr - b.sort_ordr;
    });

    const funcIds = functions.map((f) => f.func_id);

    // 기능별 단계별 진척률 조회 (tb_cm_progress)
    const progressRecords = funcIds.length > 0
      ? await prisma.tbCmProgress.findMany({
          where: { ref_tbl_nm: "tb_ds_function", ref_id: { in: funcIds } },
          select: { ref_id: true, design_rt: true, impl_rt: true, test_rt: true },
        })
      : [];
    const progressMap = new Map(progressRecords.map((p) => [p.ref_id, p]));

    // 기능별 AI 태스크 최신 상태 조회 (DESIGN, INSPECT 각각 최신 1건)
    const aiTasks = funcIds.length > 0
      ? await prisma.tbAiTask.findMany({
          where: {
            ref_ty_code:    "FUNCTION",
            ref_id:         { in: funcIds },
            task_ty_code:   { in: ["DESIGN", "INSPECT"] },
          },
          select: {
            ai_task_id:    true,
            ref_id:        true,
            task_ty_code:  true,
            task_sttus_code: true,
            req_dt:        true,
          },
          orderBy: { req_dt: "desc" },
        })
      : [];

    // funcId → { DESIGN: { id, status }, INSPECT: { id, status } } 맵 구성 (최신 1건만)
    const aiMap: Record<string, Record<string, { taskId: string; status: string }>> = {};
    for (const t of aiTasks) {
      if (!t.ref_id) continue;
      if (!aiMap[t.ref_id]) aiMap[t.ref_id] = {};
      // 이미 등록된 경우 더 최신(req_dt desc 정렬)이므로 첫 번째만 유지
      if (!aiMap[t.ref_id][t.task_ty_code]) {
        aiMap[t.ref_id][t.task_ty_code] = {
          taskId: t.ai_task_id,
          status: t.task_sttus_code,
        };
      }
    }

    const items = functions.map((f) => ({
      funcId:          f.func_id,
      displayId:       f.func_display_id,
      name:            f.func_nm,
      type:            f.func_ty_code,
      priority:        f.priort_code,
      complexity:      f.cmplx_code,
      effort:          f.efrt_val ?? "",
      sortOrder:       f.sort_ordr,
      areaId:          f.area_id ?? null,
      assignMemberId:  f.asign_mber_id ?? null,
      areaName:        f.area?.area_nm ?? "미분류",
      areaDisplayId:   f.area?.area_display_id ?? null,
      areaSortOrder:   f.area?.sort_ordr ?? 0,
      screenId:        f.area?.screen?.scrn_id ?? null,
      screenName:      f.area?.screen?.scrn_nm ?? "미분류",
      ctgryL:          f.area?.screen?.ctgry_l_nm ?? null,
      ctgryM:          f.area?.screen?.ctgry_m_nm ?? null,
      ctgryS:          f.area?.screen?.ctgry_s_nm ?? null,
      screenDisplayId: f.area?.screen?.scrn_display_id ?? null,
      unitWorkId:      f.area?.screen?.unitWork?.unit_work_id ?? null,
      unitWorkName:    f.area?.screen?.unitWork?.unit_work_nm ?? "미분류",
      aiDesign:        aiMap[f.func_id]?.["DESIGN"]  ?? null,
      aiInspect:       aiMap[f.func_id]?.["INSPECT"] ?? null,
      designRt:        progressMap.get(f.func_id)?.design_rt ?? 0,
      implRt:          progressMap.get(f.func_id)?.impl_rt   ?? 0,
      testRt:          progressMap.get(f.func_id)?.test_rt   ?? 0,
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
    assignMemberId, implStartDate, implEndDate, sortOrder,
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
        chg_mber_id: auth.mberId,
      },
    });

    return apiSuccess({ funcId: fn.func_id, displayId }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/functions] DB 오류:`, err);
    return apiError("DB_ERROR", "기능 생성에 실패했습니다.", 500);
  }
}
