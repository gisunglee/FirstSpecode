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
  // 설계 일정 — WBS 간트에서 사용 (구현 일정인 impl_bgng_de 와는 별개 축)
  startDate:        string | null;
  endDate:          string | null;
  // 구현 일정 — 화면 자신은 구현 일정 컬럼이 없어서, 하위 기능들의 impl_bgng_de/impl_end_de를
  // 최소~최대로 롤업한 값(WBS "구현" phase에서 화면 바를 그릴 때 사용).
  implStartDate:    string | null;
  implEndDate:      string | null;
  designEffort:     string | null;
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
    scrn_id:         string;
    avg_design_rt:   number;
    avg_impl_rt:     number;
    avg_test_rt:     number;
    min_impl_start:  string | null;
    max_impl_end:    string | null;
  };
  let progMap = new Map<string, {
    designRt: number; implRt: number; testRt: number;
    implStartDate: string | null; implEndDate: string | null;
  }>();
  if (screens.length > 0) {
    const screenIds = Prisma.join(screens.map((s) => s.scrn_id));
    // WBS "구현" phase용 — 화면 자신은 구현 일정이 없어 하위 기능 impl_bgng_de/impl_end_de를
    // 같은 조인에서 MIN/MAX로 같이 뽑는다(별도 쿼리 안 만듦).
    //
    // AVG(p.design_rt)는 tb_cm_progress 행이 아예 없는 기능(LEFT JOIN → NULL)을 "0점"이
    // 아니라 평균에서 통째로 제외해버린다(SQL의 AVG는 NULL 무시) — COALESCE(AVG(...),0)은
    // 전체 결과가 NULL일 때만 방어할 뿐 개별 NULL 행은 못 막아 평균이 부풀려진다(WBS 단위업무
    // 롤업 실측 중 발견). 진척률 기록이 없는 기능은 0%로 취급해야 하므로 AVG 안에서 먼저
    // COALESCE(p.xxx_rt, 0)로 개별 행을 0으로 채운 뒤 평균낸다.
    const aggRows = await prisma.$queryRaw<ScreenAgg[]>`
      SELECT a.scrn_id,
             COALESCE(AVG(COALESCE(p.design_rt, 0)), 0) AS avg_design_rt,
             COALESCE(AVG(COALESCE(p.impl_rt, 0)),   0) AS avg_impl_rt,
             COALESCE(AVG(COALESCE(p.test_rt, 0)),   0) AS avg_test_rt,
             MIN(f.impl_bgng_de) AS min_impl_start,
             MAX(f.impl_end_de)  AS max_impl_end
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
      implStartDate: r.min_impl_start ?? null,
      implEndDate:   r.max_impl_end   ?? null,
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
      startDate:        s.design_bgng_de ?? null,
      endDate:          s.design_end_de ?? null,
      implStartDate:    prog?.implStartDate ?? null,
      implEndDate:      prog?.implEndDate ?? null,
      designEffort:     s.design_efrt_val ?? null,
      avgDesignRt:      prog?.designRt ?? 0,
      avgImplRt:        prog?.implRt ?? 0,
      avgTestRt:        prog?.testRt ?? 0,
      implTask:         impl ?? null,
    };
  });
}
