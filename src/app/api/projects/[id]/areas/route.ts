/**
 * GET  /api/projects/[id]/areas — 영역 목록 조회 (FID-00151)
 * POST /api/projects/[id]/areas — 영역 생성 + 이력 (FID-00154)
 *
 * GET Query: screenId? (선택적 화면 필터)
 */

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 영역 목록 조회 ────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const url      = new URL(request.url);
  const screenId = url.searchParams.get("screenId") ?? undefined;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

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

    // DB 레벨에서 영역별 집계 — 공수 합산, 구현 시작/종료일, 평균 진행률
    type AreaAgg = {
      area_id: string;
      total_hours: number;
      impl_start: string | null;
      impl_end: string | null;
      avg_design_rt: number;
      avg_impl_rt: number;
      avg_test_rt: number;
    };
    let aggMap = new Map<string, AreaAgg>();

    if (areas.length > 0) {
      const areaIds = Prisma.join(areas.map(a => a.area_id));

      const aggRows = await prisma.$queryRaw<AreaAgg[]>`
        SELECT
          f.area_id,
          COALESCE(SUM(
            CAST(REGEXP_REPLACE(f.efrt_val, '[^0-9.]', '', 'g') AS DECIMAL)
          ) FILTER (WHERE f.efrt_val IS NOT NULL), 0) AS total_hours,
          MIN(f.impl_bgng_de) AS impl_start,
          MAX(f.impl_end_de)  AS impl_end,
          COALESCE(AVG(p.design_rt), 0) AS avg_design_rt,
          COALESCE(AVG(p.impl_rt),   0) AS avg_impl_rt,
          COALESCE(AVG(p.test_rt),   0) AS avg_test_rt
        FROM tb_ds_function f
        LEFT JOIN tb_cm_progress p
          ON p.ref_tbl_nm = 'tb_ds_function' AND p.ref_id = f.func_id
        WHERE f.area_id IN (${areaIds})
        GROUP BY f.area_id
      `;
      aggMap = new Map(aggRows.map(r => [r.area_id, {
        ...r,
        total_hours:   Number(r.total_hours),
        avg_design_rt: Math.round(Number(r.avg_design_rt)),
        avg_impl_rt:   Math.round(Number(r.avg_impl_rt)),
        avg_test_rt:   Math.round(Number(r.avg_test_rt)),
      }]));
    }

    // ── AI 구현 요청 정보 — 영역 단위 스냅샷 → IMPLEMENT 태스크 최신 1건 ─────
    const implTaskMap = new Map<string, { aiTaskId: string; status: string; requestedAt: Date }>();
    if (areas.length > 0) {
      const areaIds = areas.map((a) => a.area_id);
      const implSnapshots = await prisma.tbSpImplSnapshot.findMany({
        where:  { ref_tbl_nm: "tb_ds_area", ref_id: { in: areaIds } },
        select: { ref_id: true, ai_task_id: true, creat_dt: true },
        orderBy: { creat_dt: "desc" },
      });
      if (implSnapshots.length > 0) {
        const allTaskIds = [...new Set(implSnapshots.map((s) => s.ai_task_id))];
        const implTasks = await prisma.tbAiTask.findMany({
          where:  { ai_task_id: { in: allTaskIds }, task_ty_code: "IMPLEMENT" },
          select: { ai_task_id: true, task_sttus_code: true, req_dt: true },
        });
        const taskInfoMap = new Map(implTasks.map((t) => [t.ai_task_id, t]));

        for (const snap of implSnapshots) {
          if (implTaskMap.has(snap.ref_id)) continue;
          const task = taskInfoMap.get(snap.ai_task_id);
          if (!task) continue;
          implTaskMap.set(snap.ref_id, {
            aiTaskId:    task.ai_task_id,
            status:      task.task_sttus_code,
            requestedAt: task.req_dt,
          });
        }
      }
    }

    const items = areas.map((a) => {
      const agg = aggMap.get(a.area_id);
      const impl = implTaskMap.get(a.area_id);
      return {
        areaId:          a.area_id,
        displayId:       a.area_display_id,
        name:            a.area_nm,
        type:            a.area_ty_code,
        displayFormCode: a.display_form_code,
        sortOrder:       a.sort_ordr,
        screenId:        a.scrn_id ?? null,
        screenName:      a.screen?.scrn_nm ?? "미분류",
        screenDisplayId: a.screen?.scrn_display_id ?? null,
        unitWorkId:      a.screen?.unitWork?.unit_work_id ?? null,
        unitWorkName:    a.screen?.unitWork?.unit_work_nm ?? null,
        functionCount:      a._count.functions,
        totalEffortHours:   agg?.total_hours ?? 0,
        implStart:          agg?.impl_start ?? null,
        implEnd:            agg?.impl_end ?? null,
        avgDesignRt:        agg?.avg_design_rt ?? 0,
        avgImplRt:          agg?.avg_impl_rt ?? 0,
        avgTestRt:          agg?.avg_test_rt ?? 0,
        // AI 구현 요청 정보 (스냅샷 → IMPLEMENT 태스크 최신 1건)
        implTask:           impl ? { aiTaskId: impl.aiTaskId, status: impl.status, requestedAt: impl.requestedAt } : null,
      };
    });

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
      displayId = `AR-${String(nextNum).padStart(5, "0")}`;
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
