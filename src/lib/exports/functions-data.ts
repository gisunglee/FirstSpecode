/**
 * exports/functions-data.ts — 기능 목록 데이터 조립 (서버 공용)
 */

import { prisma } from "@/lib/prisma";

export type FunctionAiTaskInfo = { taskId: string; status: string };

export type FunctionListItem = {
  funcId:          string;
  displayId:       string;
  name:            string;
  type:            string;
  priority:        string;
  complexity:      string;
  effort:          string;
  sortOrder:       number;
  areaId:          string | null;
  assignMemberId:  string | null;
  assignMemberName: string | null;
  areaName:        string;
  areaDisplayId:   string | null;
  areaSortOrder:   number;
  screenId:        string | null;
  screenName:      string;
  ctgryL:          string | null;
  ctgryM:          string | null;
  ctgryS:          string | null;
  screenDisplayId: string | null;
  unitWorkId:      string | null;
  unitWorkName:    string;
  // 구현 일정 — 기능 자신은 구현 일정 컬럼이 없음(담당 화면 마감 안에서 개인 소관).
  // WBS "구현" phase에서 기능 바를 그릴 때 부모 화면의 실질구현기간을 그대로 상속해서 쓴다.
  startDate:       string | null;
  endDate:         string | null;
  // 부모 화면의 실질 설계 일정 — WBS "설계" phase에서 기능 바를 그릴 때 상속해서 쓴다.
  screenDesignStartDate: string | null;
  screenDesignEndDate:   string | null;
  aiDesign:        FunctionAiTaskInfo | null;
  aiInspect:       FunctionAiTaskInfo | null;
  designRt:        number;
  implRt:          number;
  testRt:          number;
};

/**
 * fetchProjectFunctions — 기능 목록 + 영역/화면/단위업무 join + 진척률 + AI 태스크 최신
 */
export async function fetchProjectFunctions(opts: {
  projectId:       string;
  areaId?:         string;
  assigneeFilter?: string;
}): Promise<FunctionListItem[]> {
  const { projectId, areaId, assigneeFilter } = opts;

  const functions = await prisma.tbDsFunction.findMany({
    where: {
      prjct_id: projectId,
      ...(areaId ? { area_id: areaId } : {}),
      ...(assigneeFilter ? { asign_mber_id: assigneeFilter } : {}),
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
              actl_dsgn_bgng_de: true,
              actl_dsgn_end_de:  true,
              actl_impl_bgng_de: true,
              actl_impl_end_de:  true,
              unitWork: {
                select: { unit_work_id: true, unit_work_nm: true, sort_ordr: true },
              },
            },
          },
        },
      },
    },
  });

  // 단위업무 → 화면 → 영역 → 기능 정렬순서로 정렬 (route 와 동일 로직)
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

  // 담당자 이름 일괄 조회 (unit-works-data.ts/screens-data.ts와 동일 패턴)
  const assigneeIds = [
    ...new Set(functions.map((f) => f.asign_mber_id).filter((v): v is string => !!v)),
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

  // 진척률
  const progressRecords = funcIds.length > 0
    ? await prisma.tbCmProgress.findMany({
        where:  { ref_tbl_nm: "tb_ds_function", ref_id: { in: funcIds } },
        select: { ref_id: true, design_rt: true, impl_rt: true, test_rt: true },
      })
    : [];
  const progressMap = new Map(progressRecords.map((p) => [p.ref_id, p]));

  // AI 태스크 (DESIGN/INSPECT 각각 최신 1건)
  const aiTasks = funcIds.length > 0
    ? await prisma.tbAiTask.findMany({
        where: {
          ref_ty_code:  "FUNCTION",
          ref_id:       { in: funcIds },
          task_ty_code: { in: ["DESIGN", "INSPECT"] },
        },
        select: {
          ai_task_id:      true,
          ref_id:          true,
          task_ty_code:    true,
          task_sttus_code: true,
          req_dt:          true,
        },
        orderBy: { req_dt: "desc" },
      })
    : [];

  const aiMap: Record<string, Record<string, FunctionAiTaskInfo>> = {};
  for (const t of aiTasks) {
    if (!t.ref_id) continue;
    if (!aiMap[t.ref_id]) aiMap[t.ref_id] = {};
    if (!aiMap[t.ref_id][t.task_ty_code]) {
      aiMap[t.ref_id][t.task_ty_code] = {
        taskId: t.ai_task_id,
        status: t.task_sttus_code,
      };
    }
  }

  return functions.map((f) => ({
    funcId:          f.func_id,
    displayId:       f.func_display_id,
    name:            f.func_nm,
    type:            f.func_ty_code,
    priority:        f.priort_code,
    complexity:      f.cmplx_code,
    effort:          f.impl_efrt_val ?? "",
    sortOrder:       f.sort_ordr,
    areaId:          f.area_id ?? null,
    assignMemberId:  f.asign_mber_id ?? null,
    assignMemberName: f.asign_mber_id ? (assigneeMap.get(f.asign_mber_id) ?? null) : null,
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
    startDate:       f.area?.screen?.actl_impl_bgng_de ?? null,
    endDate:         f.area?.screen?.actl_impl_end_de ?? null,
    screenDesignStartDate: f.area?.screen?.actl_dsgn_bgng_de ?? null,
    screenDesignEndDate:   f.area?.screen?.actl_dsgn_end_de ?? null,
    aiDesign:        aiMap[f.func_id]?.["DESIGN"]  ?? null,
    aiInspect:       aiMap[f.func_id]?.["INSPECT"] ?? null,
    designRt:        progressMap.get(f.func_id)?.design_rt ?? 0,
    implRt:          progressMap.get(f.func_id)?.impl_rt   ?? 0,
    testRt:          progressMap.get(f.func_id)?.test_rt   ?? 0,
  }));
}
