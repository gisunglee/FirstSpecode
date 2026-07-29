/**
 * exports/screens-data.ts — 화면 목록 데이터 조립 (서버 공용)
 */

import { prisma } from "@/lib/prisma";
import { fetchScreenProgress } from "@/lib/pm/progressRollup";
import { parseEffortHours } from "@/lib/effort";

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
  unitWorkDisplayId:        string | null;
  unitWorkAssignMemberId:   string | null;
  unitWorkAssignMemberName: string | null;
  assignMemberId:   string | null;
  assignMemberName: string | null;
  requirementId:    string | null;
  requirementName:  string;
  areaCount:        number;
  sortOrder:        number;
  // 설계 일정 — 화면 자신은 안 갖고(2026-07-28 2차 개편) 소속 단위업무의 계획설계기간을
  // 그대로 상속해서 보여준다(WBS 간트에서 사용). 실질구현기간은 화면 자신이 직접 가짐.
  startDate:        string | null;
  endDate:          string | null;
  implStartDate:    string | null;
  implEndDate:      string | null;
  // 화면 자신은 공수 컬럼이 없어(설계공수는 단위업무, 구현공수는 기능 소관) 하위 기능
  // 전체의 impl_efrt_val 합으로 대신 보여준다. 설계 공수는 화면 단위로 쪼갤 방법이 없어
  // (단위업무 전체 하나의 값이라) 여기선 다루지 않음 — 필요하면 소속 단위업무 쪽을 볼 것.
  implEffortHours:  number;
  // 화면정의서 작성 상태 — BEFORE(작성전) / DOING(작성중) / DONE(작성완료)
  docStatus:        string;
  avgDesignRt:      number;
  avgImplRt:        number;
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
          unit_work_display_id: true,
          asign_mber_id: true,
          plan_dsgn_bgng_de: true,
          plan_dsgn_end_de: true,
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

  // 화면별 설계/구현/테스트 진척률 — 중앙 헬퍼(lib/pm/progressRollup.ts)로 통일.
  // 구현 일정은 더 이상 기능에서 롤업하지 않음 — 화면 자신의 actl_impl_bgng_de/end_de를 그대로 씀(2026-07-28).
  const screenIds = screens.map((s) => s.scrn_id);
  const progMap = await fetchScreenProgress(screenIds);

  // 화면 자신은 구현 공수 컬럼이 없어(스키마상 기능 소관) 하위 영역→기능 전체의
  // impl_efrt_val을 걷어와 JS에서 합산한다(문자열 컬럼이라 SQL SUM 대신 parseEffortHours로).
  const implEffortFunctions = screenIds.length > 0
    ? await prisma.tbDsFunction.findMany({
        where:  { area: { scrn_id: { in: screenIds } } },
        select: { impl_efrt_val: true, area: { select: { scrn_id: true } } },
      })
    : [];
  const implEffortMap = new Map<string, number>();
  for (const f of implEffortFunctions) {
    const scrnId = f.area?.scrn_id;
    if (!scrnId) continue;
    implEffortMap.set(scrnId, (implEffortMap.get(scrnId) ?? 0) + parseEffortHours(f.impl_efrt_val));
  }

  // 담당자 이름 일괄 조회 — WBS 그룹으로 보기(화면 탭)의 요약 행이 소속 단위업무 자신의
  // 담당자도 보여줘야 해서 화면 담당자와 단위업무 담당자를 한 배치로 같이 조회한다.
  const assigneeIds = [
    ...new Set(
      screens
        .flatMap((s) => [s.asign_mber_id, s.unitWork?.asign_mber_id ?? null])
        .filter((v): v is string => !!v)
    ),
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
      unitWorkDisplayId:        s.unitWork?.unit_work_display_id ?? null,
      unitWorkAssignMemberId:   s.unitWork?.asign_mber_id ?? null,
      unitWorkAssignMemberName: s.unitWork?.asign_mber_id ? (assigneeMap.get(s.unitWork.asign_mber_id) ?? null) : null,
      assignMemberId:   s.asign_mber_id ?? null,
      assignMemberName: s.asign_mber_id ? (assigneeMap.get(s.asign_mber_id) ?? null) : null,
      requirementId:    s.unitWork?.requirement?.req_id ?? null,
      requirementName:  s.unitWork?.requirement ? s.unitWork.requirement.req_nm : "미분류",
      areaCount:        s._count.areas,
      sortOrder:        s.sort_ordr,
      startDate:        s.unitWork?.plan_dsgn_bgng_de ?? null,
      endDate:          s.unitWork?.plan_dsgn_end_de ?? null,
      implStartDate:    s.actl_impl_bgng_de ?? null,
      implEndDate:      s.actl_impl_end_de ?? null,
      implEffortHours:  implEffortMap.get(s.scrn_id) ?? 0,
      docStatus:        s.dsgn_doc_sttus_code,
      avgDesignRt:      prog?.designRt ?? 0,
      avgImplRt:        prog?.implRt ?? 0,
      implTask:         impl ?? null,
    };
  });
}
