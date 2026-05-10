/**
 * exports/screens-data.ts — 화면 목록 데이터 조립 (서버 공용)
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ScreenImplTask = {
  aiTaskId:    string;
  status:      string;
  requestedAt: Date;
};

export type ScreenListItem = {
  screenId:         string;
  displayId:        string;
  name:             string;
  type:             string;
  categoryL:        string;
  categoryM:        string;
  categoryS:        string;
  unitWorkId:       string | null;
  unitWorkName:     string;
  assignMemberId:   string | null;
  assignMemberName: string | null;
  requirementId:    string | null;
  requirementName:  string;
  areaCount:        number;
  sortOrder:        number;
  avgDesignRt:      number;
  avgImplRt:        number;
  avgTestRt:        number;
  implTask:         ScreenImplTask | null;
};

/**
 * fetchProjectScreens — 화면 목록 + 단위업무·요구사항 join + 영역 수 + 진척률 + IMPLEMENT 최신
 */
export async function fetchProjectScreens(opts: {
  projectId:       string;
  unitWorkId?:     string;
  assigneeFilter?: string;
}): Promise<ScreenListItem[]> {
  const { projectId, unitWorkId, assigneeFilter } = opts;

  const screens = await prisma.tbDsScreen.findMany({
    where: {
      prjct_id: projectId,
      ...(unitWorkId ? { unit_work_id: unitWorkId } : {}),
      ...(assigneeFilter ? { asign_mber_id: assigneeFilter } : {}),
    },
    include: {
      unitWork: {
        select: {
          unit_work_id: true,
          unit_work_nm: true,
          requirement: {
            select: { req_id: true, req_nm: true, req_display_id: true },
          },
        },
      },
      _count: { select: { areas: true } },
    },
    orderBy: [
      { unitWork: { requirement: { sort_ordr: "asc" } } },
      { unitWork: { sort_ordr: "asc" } },
      { sort_ordr: "asc" },
    ],
  });

  // 화면별 진척률 집계 (raw SQL — 화면 → 영역 → 기능 → tb_cm_progress)
  type ScreenAgg = {
    scrn_id:        string;
    avg_design_rt:  number;
    avg_impl_rt:    number;
    avg_test_rt:    number;
  };
  let progMap = new Map<string, { designRt: number; implRt: number; testRt: number }>();
  if (screens.length > 0) {
    const screenIds = Prisma.join(screens.map((s) => s.scrn_id));
    const aggRows = await prisma.$queryRaw<ScreenAgg[]>`
      SELECT a.scrn_id,
             COALESCE(AVG(p.design_rt), 0) AS avg_design_rt,
             COALESCE(AVG(p.impl_rt),   0) AS avg_impl_rt,
             COALESCE(AVG(p.test_rt),   0) AS avg_test_rt
        FROM tb_ds_area a
        JOIN tb_ds_function f ON f.area_id = a.area_id
        LEFT JOIN tb_cm_progress p
          ON p.ref_tbl_nm = 'tb_ds_function' AND p.ref_id = f.func_id
       WHERE a.scrn_id IN (${screenIds})
       GROUP BY a.scrn_id
    `;
    progMap = new Map(aggRows.map((r) => [r.scrn_id, {
      designRt: Math.round(Number(r.avg_design_rt)),
      implRt:   Math.round(Number(r.avg_impl_rt)),
      testRt:   Math.round(Number(r.avg_test_rt)),
    }]));
  }

  // 담당자 이름 일괄 조회
  const assigneeIds = [
    ...new Set(screens.map((s) => s.asign_mber_id).filter((v): v is string => !!v)),
  ];
  const assigneeMembers = assigneeIds.length > 0
    ? await prisma.tbCmMember.findMany({
        where:  { mber_id: { in: assigneeIds } },
        select: { mber_id: true, mber_nm: true, email_addr: true },
      })
    : [];
  const assigneeMap = new Map(
    assigneeMembers.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null]),
  );

  // 화면 단위 IMPLEMENT 태스크 최신 1건
  const implTaskMap = new Map<string, ScreenImplTask>();
  if (screens.length > 0) {
    const screenIds = screens.map((s) => s.scrn_id);
    const implSnapshots = await prisma.tbSpImplSnapshot.findMany({
      where:  { ref_tbl_nm: "tb_ds_screen", ref_id: { in: screenIds } },
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

  return screens.map((s) => {
    const prog = progMap.get(s.scrn_id);
    const impl = implTaskMap.get(s.scrn_id);
    return {
      screenId:         s.scrn_id,
      displayId:        s.scrn_display_id,
      name:             s.scrn_nm,
      type:             s.scrn_ty_code,
      categoryL:        s.ctgry_l_nm ?? "",
      categoryM:        s.ctgry_m_nm ?? "",
      categoryS:        s.ctgry_s_nm ?? "",
      unitWorkId:       s.unit_work_id ?? null,
      unitWorkName:     s.unitWork?.unit_work_nm ?? "미분류",
      assignMemberId:   s.asign_mber_id ?? null,
      assignMemberName: s.asign_mber_id ? (assigneeMap.get(s.asign_mber_id) ?? null) : null,
      requirementId:    s.unitWork?.requirement?.req_id ?? null,
      requirementName:  s.unitWork?.requirement ? s.unitWork.requirement.req_nm : "미분류",
      areaCount:        s._count.areas,
      sortOrder:        s.sort_ordr,
      avgDesignRt:      prog?.designRt ?? 0,
      avgImplRt:        prog?.implRt ?? 0,
      avgTestRt:        prog?.testRt ?? 0,
      implTask:         impl ?? null,
    };
  });
}
