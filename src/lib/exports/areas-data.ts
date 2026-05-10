/**
 * exports/areas-data.ts — 영역 목록 데이터 조립 (서버 공용)
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type AreaImplTask = {
  aiTaskId:    string;
  status:      string;
  requestedAt: Date;
};

export type AreaListItem = {
  areaId:           string;
  displayId:        string;
  name:             string;
  type:             string;
  displayFormCode:  string;
  sortOrder:        number;
  screenId:         string | null;
  screenName:       string;
  screenDisplayId:  string | null;
  unitWorkId:       string | null;
  unitWorkName:     string | null;
  functionCount:    number;
  totalEffortHours: number;
  implStart:        string | null;
  implEnd:          string | null;
  avgDesignRt:      number;
  avgImplRt:        number;
  avgTestRt:        number;
  implTask:         AreaImplTask | null;
};

/**
 * fetchProjectAreas — 영역 목록 + 화면/단위업무 join + 기능 수 + 공수/일정/진척률 집계
 */
export async function fetchProjectAreas(opts: {
  projectId: string;
  screenId?: string;
}): Promise<AreaListItem[]> {
  const { projectId, screenId } = opts;

  const areas = await prisma.tbDsArea.findMany({
    where: {
      prjct_id: projectId,
      ...(screenId ? { scrn_id: screenId } : {}),
    },
    orderBy: [
      { screen: { unitWork: { sort_ordr: "asc" } } },
      { screen: { sort_ordr: "asc" } },
      { sort_ordr: "asc" },
    ],
    include: {
      screen: {
        select: {
          scrn_id:         true,
          scrn_nm:         true,
          scrn_display_id: true,
          sort_ordr:       true,
          unitWork: {
            select: { unit_work_id: true, unit_work_nm: true, sort_ordr: true },
          },
        },
      },
      _count: { select: { functions: true } },
    },
  });

  // 영역별 집계 — 공수 합산, 구현 시작/종료, 평균 진행률
  type AreaAgg = {
    area_id:        string;
    total_hours:    number;
    impl_start:     string | null;
    impl_end:       string | null;
    avg_design_rt:  number;
    avg_impl_rt:    number;
    avg_test_rt:    number;
  };
  let aggMap = new Map<string, AreaAgg>();
  if (areas.length > 0) {
    const areaIds = Prisma.join(areas.map((a) => a.area_id));
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
    aggMap = new Map(aggRows.map((r) => [r.area_id, {
      ...r,
      total_hours:   Number(r.total_hours),
      avg_design_rt: Math.round(Number(r.avg_design_rt)),
      avg_impl_rt:   Math.round(Number(r.avg_impl_rt)),
      avg_test_rt:   Math.round(Number(r.avg_test_rt)),
    }]));
  }

  // 영역 단위 IMPLEMENT 태스크 최신 1건
  const implTaskMap = new Map<string, AreaImplTask>();
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

  return areas.map((a) => {
    const agg  = aggMap.get(a.area_id);
    const impl = implTaskMap.get(a.area_id);
    return {
      areaId:           a.area_id,
      displayId:        a.area_display_id,
      name:             a.area_nm,
      type:             a.area_ty_code,
      displayFormCode:  a.display_form_code,
      sortOrder:        a.sort_ordr,
      screenId:         a.scrn_id ?? null,
      screenName:       a.screen?.scrn_nm ?? "미분류",
      screenDisplayId:  a.screen?.scrn_display_id ?? null,
      unitWorkId:       a.screen?.unitWork?.unit_work_id ?? null,
      unitWorkName:     a.screen?.unitWork?.unit_work_nm ?? null,
      functionCount:    a._count.functions,
      totalEffortHours: agg?.total_hours ?? 0,
      implStart:        agg?.impl_start ?? null,
      implEnd:          agg?.impl_end ?? null,
      avgDesignRt:      agg?.avg_design_rt ?? 0,
      avgImplRt:        agg?.avg_impl_rt ?? 0,
      avgTestRt:        agg?.avg_test_rt ?? 0,
      implTask:         impl ?? null,
    };
  });
}
