/**
 * exports/ai-tasks-data.ts — AI 태스크 목록 데이터 조립 (서버 공용)
 *
 * 화면 GET 라우트(`/api/projects/[id]/ai-tasks`)와 export 라우트가 공유한다.
 * 화면 = 엑셀 결과 일치.
 *
 * 옵션:
 *   - filters : 상태/유형/대상/요청자 등 필터.
 *   - pagination : 화면 GET 은 페이지네이션 적용, export 는 미적용(전체).
 */

import { prisma } from "@/lib/prisma";

export type AiTaskImplFn = { displayId: string; name: string };

export type AiTaskListItem = {
  taskId:        string;
  taskType:      string;
  refType:       string;
  refId:         string;
  refName:       string;
  refDisplayId:  string;
  unitWorkName:  string | null;
  screenName:    string | null;
  areaName:      string | null;
  implFunctions: AiTaskImplFn[] | undefined;
  status:        string;
  comment:       string;
  resultCn:      string;
  requestedAt:   string;
  completedAt:   string | null;
  isZombie:      boolean;
  elapsedMs:     number;
  reqMberName:   string;
  retryCnt:      number;
  execAvlblDt:   string | null;
};

export type AiTaskFilters = {
  status?:           string | null;
  taskType?:         string | null;
  refType?:          string | null;
  refId?:            string | null;
  snapshotRefId?:    string | null;
  snapshotRefType?:  string | null;
  reqMberId?:        string | null;
  /** 인증된 사용자 mberId — reqMberId="me" 처리에 사용 */
  meMberId?:         string;
};

export type AiTaskPagination = {
  page:     number;
  pageSize: number;
};

export type AiTaskFetchResult = {
  items:      AiTaskListItem[];
  totalCount: number;
};

const SNAPSHOT_TBL_MAP: Record<string, string> = {
  FUNCTION:  "tb_ds_function",
  AREA:      "tb_ds_area",
  SCREEN:    "tb_ds_screen",
  UNIT_WORK: "tb_ds_unit_work",
};

/**
 * fetchProjectAiTasks — AI 태스크 목록 + 대상 entity join + 요청자 이름 + IMPLEMENT 기능 목록.
 *
 *   - pagination 미지정 시 전체 반환 (export 용).
 *   - pagination 지정 시 skip/take 적용 (화면 GET 용).
 */
export async function fetchProjectAiTasks(opts: {
  projectId:    string;
  filters?:     AiTaskFilters;
  pagination?:  AiTaskPagination;
}): Promise<AiTaskFetchResult> {
  const { projectId, filters = {}, pagination } = opts;
  const {
    status, taskType, refType, refId,
    snapshotRefId, snapshotRefType,
    reqMberId, meMberId,
  } = filters;

  // IMPLEMENT/PRE_IMPL + snapshotRefId 분기
  let snapshotTaskIds: string[] | undefined;
  const isImplQuery = snapshotRefId && (taskType === "IMPLEMENT" || taskType === "PRE_IMPL");
  if (isImplQuery) {
    const refTblNm = SNAPSHOT_TBL_MAP[snapshotRefType ?? "FUNCTION"] ?? "tb_ds_function";
    const snapshots = await prisma.tbSpImplSnapshot.findMany({
      where: { ref_tbl_nm: refTblNm, ref_id: snapshotRefId },
      select: { ai_task_id: true },
      distinct: ["ai_task_id"],
    });
    snapshotTaskIds = snapshots.map((s) => s.ai_task_id);
  }

  // IMPLEMENT 조회 시 PRE_IMPL 도 함께 포함
  const taskTypeFilter = taskType === "IMPLEMENT"
    ? { task_ty_code: { in: ["IMPLEMENT", "PRE_IMPL"] } }
    : taskType ? { task_ty_code: taskType } : {};

  let implWhereFilter: Record<string, unknown> = {};
  if (snapshotTaskIds) {
    implWhereFilter = {
      OR: [
        { ai_task_id: { in: snapshotTaskIds } },
        { task_ty_code: "PRE_IMPL", ref_id: snapshotRefId },
      ],
    };
  } else if (!isImplQuery) {
    implWhereFilter = {
      ...(refType ? { ref_ty_code: refType } : {}),
      ...(refId   ? { ref_id:      refId }   : {}),
    };
  }

  // reqMberId="me" → 인증 mberId 변환
  const reqMberIdFilter = reqMberId === "me" ? meMberId : reqMberId;

  const where = {
    prjct_id: projectId,
    ...(status ? { task_sttus_code: status } : {}),
    ...taskTypeFilter,
    ...implWhereFilter,
    ...(reqMberIdFilter ? { req_mber_id: reqMberIdFilter } : {}),
  };

  const [totalCount, tasks] = await Promise.all([
    prisma.tbAiTask.count({ where }),
    prisma.tbAiTask.findMany({
      where,
      orderBy: { req_dt: "desc" },
      ...(pagination
        ? {
            skip: (pagination.page - 1) * pagination.pageSize,
            take: pagination.pageSize,
          }
        : {}),
    }),
  ]);

  // 대상 이름 조인 — ref_ty_code 별로 일괄 조회
  const unitWorkIds = tasks.filter((t) => t.ref_ty_code === "UNIT_WORK").map((t) => t.ref_id);
  const areaIds     = tasks.filter((t) => t.ref_ty_code === "AREA")     .map((t) => t.ref_id);
  const functionIds = tasks.filter((t) => t.ref_ty_code === "FUNCTION") .map((t) => t.ref_id);
  const artfIds     = tasks.filter((t) => t.ref_ty_code === "PLAN_STUDIO_ARTF").map((t) => t.ref_id);

  const [unitWorks, areas, functions] = await Promise.all([
    unitWorkIds.length
      ? prisma.tbDsUnitWork.findMany({
          where:  { unit_work_id: { in: unitWorkIds } },
          select: { unit_work_id: true, unit_work_nm: true, unit_work_display_id: true },
        })
      : [],
    areaIds.length
      ? prisma.tbDsArea.findMany({
          where:  { area_id: { in: areaIds } },
          select: {
            area_id: true, area_nm: true, area_display_id: true,
            screen: {
              select: {
                scrn_nm: true,
                unitWork: { select: { unit_work_nm: true } },
              },
            },
          },
        })
      : [],
    functionIds.length
      ? prisma.tbDsFunction.findMany({
          where:  { func_id: { in: functionIds } },
          select: {
            func_id: true, func_nm: true, func_display_id: true,
            area: {
              select: {
                area_nm: true,
                screen: {
                  select: {
                    scrn_nm: true,
                    unitWork: { select: { unit_work_nm: true } },
                  },
                },
              },
            },
          },
        })
      : [],
  ]);

  // 기획실 산출물
  const planArtfs = artfIds.length
    ? await prisma.tbDsPlanStudioArtf.findMany({
        where: { artf_id: { in: artfIds } },
        select: {
          artf_id: true, artf_nm: true,
          planStudio: { select: { plan_studio_display_id: true, plan_studio_nm: true } },
        },
      })
    : [];

  type RefInfo = {
    name:         string;
    displayId:    string;
    unitWorkName: string | null;
    screenName:   string | null;
    areaName:     string | null;
  };

  const planArtfMap = new Map<string, RefInfo>(
    planArtfs.map((a) => [a.artf_id, {
      name:         a.artf_nm,
      displayId:    a.planStudio.plan_studio_display_id,
      unitWorkName: a.planStudio.plan_studio_nm,
      screenName:   null,
      areaName:     null,
    }])
  );
  const unitWorkMap = new Map<string, RefInfo>(
    unitWorks.map((u) => [u.unit_work_id, {
      name:         u.unit_work_nm,
      displayId:    u.unit_work_display_id,
      unitWorkName: null,
      screenName:   null,
      areaName:     null,
    }])
  );
  const areaMap = new Map<string, RefInfo>(
    areas.map((a) => [a.area_id, {
      name:         a.area_nm,
      displayId:    a.area_display_id,
      unitWorkName: a.screen?.unitWork?.unit_work_nm ?? null,
      screenName:   a.screen?.scrn_nm ?? null,
      areaName:     null,
    }])
  );
  const functionMap = new Map<string, RefInfo>(
    functions.map((f) => [f.func_id, {
      name:         f.func_nm,
      displayId:    f.func_display_id,
      unitWorkName: f.area?.screen?.unitWork?.unit_work_nm ?? null,
      screenName:   f.area?.screen?.scrn_nm ?? null,
      areaName:     f.area?.area_nm ?? null,
    }])
  );

  const now         = Date.now();
  const FIVE_MIN_MS = 5 * 60 * 1000;

  // 요청자 이름 일괄 조회
  const mberIds = Array.from(new Set(tasks.map((t) => t.req_mber_id).filter(Boolean))) as string[];
  const members = mberIds.length
    ? await prisma.tbCmMember.findMany({
        where:  { mber_id: { in: mberIds } },
        select: { mber_id: true, mber_nm: true },
      })
    : [];
  const memberMap = new Map(members.map((m) => [m.mber_id, m.mber_nm]));

  // IMPLEMENT 태스크의 기능 목록 (스냅샷에서 기능명 추출)
  const implTaskIds = tasks.filter((t) => t.task_ty_code === "IMPLEMENT").map((t) => t.ai_task_id);
  const implFnMap = new Map<string, AiTaskImplFn[]>();
  if (implTaskIds.length > 0) {
    const implSnapshots = await prisma.tbSpImplSnapshot.findMany({
      where:  { ai_task_id: { in: implTaskIds }, ref_tbl_nm: "tb_ds_function" },
      select: { ai_task_id: true, ref_id: true },
    });
    const implFnIds = [...new Set(implSnapshots.map((s) => s.ref_id))];
    const implFns = implFnIds.length > 0
      ? await prisma.tbDsFunction.findMany({
          where:  { func_id: { in: implFnIds } },
          select: { func_id: true, func_display_id: true, func_nm: true },
        })
      : [];
    const fnLookup = new Map(implFns.map((f) => [f.func_id, { displayId: f.func_display_id, name: f.func_nm }]));

    for (const snap of implSnapshots) {
      const fn = fnLookup.get(snap.ref_id);
      if (!fn) continue;
      const list = implFnMap.get(snap.ai_task_id) ?? [];
      list.push(fn);
      implFnMap.set(snap.ai_task_id, list);
    }
  }

  const items: AiTaskListItem[] = tasks.map((t) => {
    const isImpl = t.task_ty_code === "IMPLEMENT";
    const implFns = isImpl ? (implFnMap.get(t.ai_task_id) ?? []) : [];

    const refInfo = t.ref_ty_code === "UNIT_WORK"
      ? unitWorkMap.get(t.ref_id)
      : t.ref_ty_code === "AREA"
      ? areaMap.get(t.ref_id)
      : t.ref_ty_code === "PLAN_STUDIO_ARTF"
      ? planArtfMap.get(t.ref_id)
      : functionMap.get(t.ref_id);

    const isZombie =
      t.task_sttus_code === "IN_PROGRESS" &&
      now - t.req_dt.getTime() > FIVE_MIN_MS;

    return {
      taskId:        t.ai_task_id,
      taskType:      t.task_ty_code,
      refType:       isImpl ? "FUNCTION" : t.ref_ty_code,
      refId:         t.ref_id,
      refName:       isImpl && implFns.length > 0
        ? `${implFns[0].name} (기능 ${implFns.length}개)`
        : (refInfo?.name ?? "알 수 없음"),
      refDisplayId:  isImpl && implFns.length > 0
        ? implFns[0].displayId
        : (refInfo?.displayId ?? ""),
      unitWorkName:  refInfo?.unitWorkName ?? null,
      screenName:    refInfo?.screenName   ?? null,
      areaName:      refInfo?.areaName     ?? null,
      implFunctions: isImpl && implFns.length > 0 ? implFns : undefined,
      status:        t.task_sttus_code,
      comment:       t.coment_cn ?? "",
      resultCn:      t.result_cn ?? "",
      requestedAt:   t.req_dt.toISOString(),
      completedAt:   t.compl_dt?.toISOString() ?? null,
      isZombie,
      elapsedMs:     t.compl_dt ? (t.compl_dt.getTime() - t.req_dt.getTime()) : (now - t.req_dt.getTime()),
      reqMberName:   t.req_mber_id ? (memberMap.get(t.req_mber_id) ?? "—") : "—",
      retryCnt:      t.retry_cnt ?? 0,
      execAvlblDt:   t.exec_avlbl_dt?.toISOString() ?? null,
    };
  });

  return { items, totalCount };
}
