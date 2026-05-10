/**
 * exports/unit-works-data.ts — 단위업무 목록 데이터 조립 (서버 공용)
 */

import { prisma } from "@/lib/prisma";

export type UnitWorkImplTask = {
  aiTaskId:    string;
  status:      string;
  requestedAt: Date;
};

export type UnitWorkListItem = {
  unitWorkId:       string;
  displayId:        string;
  name:             string;
  description:      string;
  assignMemberId:   string | null;
  assignMemberName: string | null;
  startDate:        string | null;
  endDate:          string | null;
  progress:         number;
  sortOrder:        number;
  reqId:            string;
  reqDisplayId:     string;
  reqName:          string;
  screenCount:      number;
  analyRt:          number;
  designRt:         number;
  implRt:           number;
  testRt:           number;
  implTask:         UnitWorkImplTask | null;
};

/**
 * fetchProjectUnitWorks — 단위업무 목록 + 진척률 + IMPLEMENT 스냅샷 + 담당자 join
 *
 *   - reqId : 특정 요구사항 산하만
 *   - assigneeFilter : 특정 mberId. ("me" → mberId 변환은 호출자 책임)
 */
export async function fetchProjectUnitWorks(opts: {
  projectId:       string;
  reqId?:          string;
  assigneeFilter?: string;
}): Promise<UnitWorkListItem[]> {
  const { projectId, reqId, assigneeFilter } = opts;

  const unitWorks = await prisma.tbDsUnitWork.findMany({
    where: {
      prjct_id: projectId,
      ...(reqId ? { req_id: reqId } : {}),
      ...(assigneeFilter ? { asign_mber_id: assigneeFilter } : {}),
    },
    include: {
      requirement: { select: { req_id: true, req_display_id: true, req_nm: true } },
      screens:     { select: { scrn_id: true } },
    },
    orderBy: [
      { requirement: { sort_ordr: "asc" } },
      { sort_ordr: "asc" },
    ],
  });

  const unitWorkIds = unitWorks.map((uw) => uw.unit_work_id);
  const assigneeIds = [
    ...new Set(unitWorks.map((u) => u.asign_mber_id).filter((v): v is string => !!v)),
  ];

  // 진척률 + IMPLEMENT 스냅샷 + 담당자 이름 병렬 조회 (N+1 방지)
  const [progressRecords, implSnapshots, assigneeMembers] = await Promise.all([
    unitWorkIds.length > 0
      ? prisma.tbCmProgress.findMany({
          where:  { ref_tbl_nm: "tb_ds_unit_work", ref_id: { in: unitWorkIds } },
          select: { ref_id: true, analy_rt: true, design_rt: true, impl_rt: true, test_rt: true },
        })
      : Promise.resolve([]),
    unitWorkIds.length > 0
      ? prisma.tbSpImplSnapshot.findMany({
          where:  { ref_tbl_nm: "tb_ds_unit_work", ref_id: { in: unitWorkIds } },
          select: { ref_id: true, ai_task_id: true, creat_dt: true },
          orderBy: { creat_dt: "desc" },
        })
      : Promise.resolve([]),
    assigneeIds.length > 0
      ? prisma.tbCmMember.findMany({
          where:  { mber_id: { in: assigneeIds } },
          select: { mber_id: true, mber_nm: true, email_addr: true },
        })
      : Promise.resolve([]),
  ]);
  const progressMap = new Map(progressRecords.map((p) => [p.ref_id, p]));
  const assigneeMap = new Map(
    assigneeMembers.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null]),
  );

  // IMPLEMENT 태스크 최신 1건 매핑
  const implTaskMap = new Map<string, UnitWorkImplTask>();
  if (implSnapshots.length > 0) {
    const allTaskIds = [...new Set(implSnapshots.map((s) => s.ai_task_id))];
    const implTasks = await prisma.tbAiTask.findMany({
      where: { ai_task_id: { in: allTaskIds }, task_ty_code: "IMPLEMENT" },
      select: { ai_task_id: true, task_sttus_code: true, req_dt: true },
    });
    const taskInfoMap = new Map(implTasks.map((t) => [t.ai_task_id, t]));

    // 스냅샷이 creat_dt desc로 정렬되어 있으므로 첫 번째 매칭이 최신
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

  return unitWorks.map((uw) => {
    const prog = progressMap.get(uw.unit_work_id);
    const impl = implTaskMap.get(uw.unit_work_id);
    return {
      unitWorkId:       uw.unit_work_id,
      displayId:        uw.unit_work_display_id,
      name:             uw.unit_work_nm,
      description:      uw.unit_work_dc ?? "",
      assignMemberId:   uw.asign_mber_id ?? null,
      assignMemberName: uw.asign_mber_id ? (assigneeMap.get(uw.asign_mber_id) ?? null) : null,
      startDate:        uw.bgng_de ?? null,
      endDate:          uw.end_de ?? null,
      progress:         uw.progrs_rt,
      sortOrder:        uw.sort_ordr,
      reqId:            uw.req_id,
      reqDisplayId:     uw.requirement.req_display_id,
      reqName:          uw.requirement.req_nm,
      screenCount:      uw.screens.length,
      analyRt:          prog?.analy_rt  ?? 0,
      designRt:         prog?.design_rt ?? 0,
      implRt:           prog?.impl_rt   ?? 0,
      testRt:           prog?.test_rt   ?? 0,
      implTask:         impl ?? null,
    };
  });
}
