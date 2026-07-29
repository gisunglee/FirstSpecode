/**
 * exports/unit-works-data.ts — 단위업무 목록 데이터 조립 (서버 공용)
 */

import { prisma } from "@/lib/prisma";
import { fetchUnitWorkProgress, combinePhaseProgress } from "@/lib/pm/progressRollup";
import { parseEffortHours } from "@/lib/effort";

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
  // 계획설계 기간 — PM이 잡는 상위 마일스톤(목표치)
  planStartDate:    string | null;
  planEndDate:      string | null;
  // 구현 기간 — 하위 화면들의 실질구현기간(actl_impl_*) 중 가장 이른 시작일 / 가장 늦은 종료일.
  // 화면마다 실제 구현 일정이 따로 있어(2026-07-28 2차 개편) 단위업무 자신은 값을 갖지 않고,
  // 목록에서 훑어볼 수 있도록 하위 화면 전체 범위를 계산해서 보여준다.
  implStartDate:    string | null;
  implEndDate:      string | null;
  // 계획설계 공수 — 단위업무 자신의 값(plan_dsgn_efrt_val). 구현 공수는 단위업무 자신에겐
  // 없어(스키마상 기능 소관) 하위 기능 전체의 impl_efrt_val 합으로 대신 보여준다.
  designEffort:     string | null;
  implEffortHours:  number;
  // 단위업무 설계서 작성 상태 — BEFORE(작성전) / DOING(작성중) / DONE(작성완료)
  docStatus:        string;
  // 실적 진행률 — 사람이 직접 입력하지 않고 하위 화면·기능에서 항상 재계산(단일 소스)
  designRt:         number;
  implRt:           number;
  progress:         number;
  sortOrder:        number;
  reqId:            string;
  reqDisplayId:     string;
  reqName:          string;
  reqAssignMemberId:   string | null;
  reqAssignMemberName: string | null;
  screenCount:      number;
  implTask:         UnitWorkImplTask | null;
};

// 하위 화면들의 실질구현기간 중 가장 이른 시작일 / 가장 늦은 종료일 계산.
// "YYYY-MM-DD" 형식 문자열은 사전식 비교가 곧 날짜 비교와 같아 별도 파싱 없이 비교 가능.
function computeImplRange(
  screens: { actl_impl_bgng_de: string | null; actl_impl_end_de: string | null }[],
): { implStartDate: string | null; implEndDate: string | null } {
  const starts = screens.map((s) => s.actl_impl_bgng_de).filter((d): d is string => !!d);
  const ends = screens.map((s) => s.actl_impl_end_de).filter((d): d is string => !!d);
  return {
    implStartDate: starts.length > 0 ? starts.reduce((a, b) => (a < b ? a : b)) : null,
    implEndDate:   ends.length   > 0 ? ends.reduce((a, b) => (a > b ? a : b))   : null,
  };
}

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
      requirement: { select: { req_id: true, req_display_id: true, req_nm: true, asign_mber_id: true } },
      screens:     { select: { scrn_id: true, actl_impl_bgng_de: true, actl_impl_end_de: true } },
    },
    // plan_dsgn_efrt_val 는 findMany의 select/include 없이도 기본으로 딸려오는 스칼라 컬럼이라
    // 위 include 블록엔 안 보이지만 uw 객체에 그대로 존재한다(Prisma 기본 동작).
    orderBy: [
      { requirement: { sort_ordr: "asc" } },
      { sort_ordr: "asc" },
    ],
  });

  const unitWorkIds = unitWorks.map((uw) => uw.unit_work_id);
  // WBS 그룹으로 보기(단위업무 탭)의 요약 행이 요구사항 자신의 담당자도 보여줘야 해서
  // 단위업무 담당자와 요구사항 담당자를 한 배치로 같이 조회한다.
  const assigneeIds = [
    ...new Set(
      unitWorks
        .flatMap((u) => [u.asign_mber_id, u.requirement.asign_mber_id])
        .filter((v): v is string => !!v)
    ),
  ];

  // 진척률(하위 화면·기능 롤업) + IMPLEMENT 스냅샷 + 담당자 이름 + 구현 공수(하위 기능 합) 병렬 조회 (N+1 방지)
  const [progressMap, implSnapshots, assigneeMembers, implEffortFunctions] = await Promise.all([
    fetchUnitWorkProgress(unitWorkIds),
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
    // 단위업무 자신은 구현 공수 컬럼이 없어(스키마상 기능 소관) 하위 화면→영역→기능 전체의
    // impl_efrt_val을 걷어와 JS에서 합산한다(문자열 컬럼이라 SQL SUM 대신 parseEffortHours로).
    unitWorkIds.length > 0
      ? prisma.tbDsFunction.findMany({
          where:  { area: { screen: { unit_work_id: { in: unitWorkIds } } } },
          select: { impl_efrt_val: true, area: { select: { screen: { select: { unit_work_id: true } } } } },
        })
      : Promise.resolve([]),
  ]);
  const assigneeMap = new Map(
    assigneeMembers.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null]),
  );

  const implEffortMap = new Map<string, number>();
  for (const f of implEffortFunctions) {
    const uwId = f.area?.screen?.unit_work_id;
    if (!uwId) continue;
    implEffortMap.set(uwId, (implEffortMap.get(uwId) ?? 0) + parseEffortHours(f.impl_efrt_val));
  }

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
    const implRange = computeImplRange(uw.screens);
    return {
      unitWorkId:       uw.unit_work_id,
      displayId:        uw.unit_work_display_id,
      name:             uw.unit_work_nm,
      description:      uw.unit_work_dc ?? "",
      assignMemberId:   uw.asign_mber_id ?? null,
      assignMemberName: uw.asign_mber_id ? (assigneeMap.get(uw.asign_mber_id) ?? null) : null,
      planStartDate:    uw.plan_dsgn_bgng_de ?? null,
      planEndDate:      uw.plan_dsgn_end_de ?? null,
      implStartDate:    implRange.implStartDate,
      implEndDate:      implRange.implEndDate,
      designEffort:     uw.plan_dsgn_efrt_val ?? null,
      implEffortHours:  implEffortMap.get(uw.unit_work_id) ?? 0,
      docStatus:        uw.dsgn_doc_sttus_code,
      designRt:         prog?.designRt ?? 0,
      implRt:           prog?.implRt ?? 0,
      progress:         prog ? combinePhaseProgress(prog) : 0,
      sortOrder:        uw.sort_ordr,
      reqId:            uw.req_id,
      reqDisplayId:     uw.requirement.req_display_id,
      reqName:          uw.requirement.req_nm,
      reqAssignMemberId:   uw.requirement.asign_mber_id ?? null,
      reqAssignMemberName: uw.requirement.asign_mber_id ? (assigneeMap.get(uw.requirement.asign_mber_id) ?? null) : null,
      screenCount:      uw.screens.length,
      implTask:         impl ?? null,
    };
  });
}
