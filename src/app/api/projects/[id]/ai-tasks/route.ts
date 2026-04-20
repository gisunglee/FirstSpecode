/**
 * GET  /api/projects/[id]/ai-tasks — AI 태스크 목록 조회 (FID-00182)
 * POST /api/projects/[id]/ai-tasks — AI 태스크 생성 (FID-00185)
 *
 * GET Query:
 *   status?   — PENDING|IN_PROGRESS|DONE|APPLIED|REJECTED|FAILED|TIMEOUT
 *   taskType? — INSPECT|DESIGN|IMPLEMENT|MOCKUP|IMPACT|CUSTOM
 *   refType?  — UNIT_WORK|AREA|FUNCTION
 *   snapshotRefId? — 스냅샷 경유 조회 (IMPLEMENT 전용: 해당 기능이 포함된 태스크)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: AI 태스크 목록 조회 ─────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;
  const url      = new URL(request.url);
  const status     = url.searchParams.get("status")     ?? undefined;
  const taskType   = url.searchParams.get("taskType")   ?? undefined;
  const refType    = url.searchParams.get("refType")    ?? undefined;
  const refId      = url.searchParams.get("refId")      ?? undefined;
  const snapshotRefId = url.searchParams.get("snapshotRefId") ?? undefined;
  const snapshotRefType = url.searchParams.get("snapshotRefType") ?? undefined; // FUNCTION|AREA|SCREEN|UNIT_WORK
  const reqMberId  = url.searchParams.get("reqMberId")  ?? undefined;
  const page     = Math.max(1, parseInt(url.searchParams.get("page")     ?? "1",  10));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "20", 10)));

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    // IMPLEMENT + snapshotRefId: 스냅샷 테이블에서 해당 노드가 포함된 ai_task_id 목록 조회
    // snapshotRefType(FUNCTION|AREA|SCREEN|UNIT_WORK)에 따라 ref_tbl_nm 결정
    const SNAPSHOT_TBL_MAP: Record<string, string> = {
      FUNCTION: "tb_ds_function",
      AREA: "tb_ds_area",
      SCREEN: "tb_ds_screen",
      UNIT_WORK: "tb_ds_unit_work",
    };
    let snapshotTaskIds: string[] | undefined;
    // IMPLEMENT 이력 조회 시 PRE_IMPL(선 구현 적용) 태스크도 동일 스냅샷을 사용하므로 함께 조회
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

    // IMPLEMENT 조회 시 PRE_IMPL도 함께 포함
    const taskTypeFilter = taskType === "IMPLEMENT"
      ? { task_ty_code: { in: ["IMPLEMENT", "PRE_IMPL"] } }
      : taskType ? { task_ty_code: taskType } : {};

    // PRE_IMPL은 선택된 레이어만 스냅샷을 저장하므로
    // 스냅샷 경유 조회만으로는 매칭 안 될 수 있음 (예: 영역만 리셋했는데 단위업무 이력에서 조회)
    // → 스냅샷 경유(IMPLEMENT) OR 태스크 ref_id 직접 매칭(PRE_IMPL) 으로 합산
    let implWhereFilter = {};
    if (snapshotTaskIds) {
      // PRE_IMPL은 태스크의 ref_id가 entryId(단위업무 등)이므로 직접 매칭도 시도
      implWhereFilter = {
        OR: [
          { ai_task_id: { in: snapshotTaskIds } },
          // PRE_IMPL 태스크는 ref_id(=entryId)로 직접 매칭
          { task_ty_code: "PRE_IMPL", ref_id: snapshotRefId },
        ],
      };
    } else if (!isImplQuery) {
      implWhereFilter = {
        ...(refType ? { ref_ty_code: refType } : {}),
        ...(refId   ? { ref_id:      refId }   : {}),
      };
    }

    const where = {
      prjct_id: projectId,
      ...(status ? { task_sttus_code: status } : {}),
      ...taskTypeFilter,
      ...implWhereFilter,
      ...(reqMberId ? { req_mber_id:     reqMberId }  : {}),
    };

    const [totalCount, tasks] = await Promise.all([
      prisma.tbAiTask.count({ where }),
      prisma.tbAiTask.findMany({
        where,
        orderBy: { req_dt: "desc" },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
      }),
    ]);

    // 대상 이름 조인 — ref_ty_code 에 따라 UnitWork / Area / Function / PlanStudioArtf 조회
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

    // 기획실 산출물 조회
    const planArtfs = artfIds.length
      ? await prisma.tbDsPlanStudioArtf.findMany({
          where: { artf_id: { in: artfIds } },
          select: {
            artf_id: true, artf_nm: true,
            planStudio: { select: { plan_studio_display_id: true, plan_studio_nm: true } },
          },
        })
      : [];
    const planArtfMap = new Map(
      planArtfs.map((a) => [a.artf_id, {
        name:         a.artf_nm,
        displayId:    a.planStudio.plan_studio_display_id,
        unitWorkName: a.planStudio.plan_studio_nm,
        screenName:   null as string | null,
        areaName:     null as string | null,
      }])
    );

    const unitWorkMap = new Map(
      unitWorks.map((u) => [u.unit_work_id, {
        name:         u.unit_work_nm,
        displayId:    u.unit_work_display_id,
        unitWorkName: null as string | null,
        screenName:   null as string | null,
        areaName:     null as string | null,
      }])
    );
    const areaMap = new Map(
      areas.map((a) => [a.area_id, {
        name:         a.area_nm,
        displayId:    a.area_display_id,
        unitWorkName: a.screen?.unitWork?.unit_work_nm ?? null,
        screenName:   a.screen?.scrn_nm ?? null,
        areaName:     null as string | null,
      }])
    );
    const functionMap = new Map(
      functions.map((f) => [f.func_id, {
        name:         f.func_nm,
        displayId:    f.func_display_id,
        unitWorkName: f.area?.screen?.unitWork?.unit_work_nm ?? null,
        screenName:   f.area?.screen?.scrn_nm ?? null,
        areaName:     f.area?.area_nm ?? null,
      }])
    );

    const now = Date.now();
    const FIVE_MIN_MS = 5 * 60 * 1000;

    // 요청자 이름 조회 (TbAiTask 에 reqMber 관계가 정의되지 않은 경우를 대비해 수동 조회)
    const mberIds = Array.from(new Set(tasks.map(t => t.req_mber_id).filter(Boolean))) as string[];
    const members = mberIds.length 
      ? await prisma.tbCmMember.findMany({
          where: { mber_id: { in: mberIds } },
          select: { mber_id: true, mber_nm: true },
        })
      : [];
    const memberMap = new Map(members.map(m => [m.mber_id, m.mber_nm]));

    // IMPLEMENT 태스크의 기능 목록 조회 (스냅샷에서 기능명 추출)
    const implTaskIds = tasks.filter((t) => t.task_ty_code === "IMPLEMENT").map((t) => t.ai_task_id);
    const implFnMap = new Map<string, { displayId: string; name: string }[]>();
    if (implTaskIds.length > 0) {
      const implSnapshots = await prisma.tbSpImplSnapshot.findMany({
        where: { ai_task_id: { in: implTaskIds }, ref_tbl_nm: "tb_ds_function" },
        select: { ai_task_id: true, ref_id: true },
      });
      // 기능 ID 수집 → 기능명 조회
      const implFnIds = [...new Set(implSnapshots.map((s) => s.ref_id))];
      const implFns = implFnIds.length > 0
        ? await prisma.tbDsFunction.findMany({
            where: { func_id: { in: implFnIds } },
            select: { func_id: true, func_display_id: true, func_nm: true },
          })
        : [];
      const fnLookup = new Map(implFns.map((f) => [f.func_id, { displayId: f.func_display_id, name: f.func_nm }]));

      // 태스크별 기능 목록 매핑
      for (const snap of implSnapshots) {
        const fn = fnLookup.get(snap.ref_id);
        if (!fn) continue;
        const list = implFnMap.get(snap.ai_task_id) ?? [];
        list.push(fn);
        implFnMap.set(snap.ai_task_id, list);
      }
    }

    const items = tasks.map((t) => {
      const isImpl = t.task_ty_code === "IMPLEMENT";
      const implFns = isImpl ? (implFnMap.get(t.ai_task_id) ?? []) : [];

      const refInfo = t.ref_ty_code === "UNIT_WORK"
        ? unitWorkMap.get(t.ref_id)
        : t.ref_ty_code === "AREA"
        ? areaMap.get(t.ref_id)
        : t.ref_ty_code === "PLAN_STUDIO_ARTF"
        ? planArtfMap.get(t.ref_id)
        : functionMap.get(t.ref_id);

      // IN_PROGRESS 상태에서 5분 초과 여부 계산 (강제 취소 버튼 노출 플래그)
      const isZombie =
        t.task_sttus_code === "IN_PROGRESS" &&
        now - t.req_dt.getTime() > FIVE_MIN_MS;

      return {
        taskId:       t.ai_task_id,
        taskType:     t.task_ty_code,
        // IMPLEMENT는 요청 구분을 "기능"으로 표시
        refType:      isImpl ? "FUNCTION" : t.ref_ty_code,
        refId:        t.ref_id,
        refName:      isImpl && implFns.length > 0
          ? `${implFns[0].name} (기능 ${implFns.length}개)`
          : (refInfo?.name ?? "알 수 없음"),
        refDisplayId: isImpl && implFns.length > 0
          ? implFns[0].displayId
          : (refInfo?.displayId ?? ""),
        unitWorkName: refInfo?.unitWorkName ?? null,
        screenName:   refInfo?.screenName   ?? null,
        areaName:     refInfo?.areaName     ?? null,
        // IMPLEMENT 태스크에 포함된 기능 목록 (목록 페이지 표시용)
        implFunctions: isImpl && implFns.length > 0 ? implFns : undefined,
        status:       t.task_sttus_code,
        comment:     t.coment_cn ?? "",
        resultCn:    t.result_cn ?? "",
        requestedAt: t.req_dt.toISOString(),
        completedAt: t.compl_dt?.toISOString() ?? null,
        isZombie,         // 5분 초과 IN_PROGRESS
        elapsedMs:   t.compl_dt ? (t.compl_dt.getTime() - t.req_dt.getTime()) : (now - t.req_dt.getTime()),
        reqMberName: t.req_mber_id ? (memberMap.get(t.req_mber_id) ?? "—") : "—",
        retryCnt:    t.retry_cnt ?? 0,
        execAvlblDt: t.exec_avlbl_dt?.toISOString() ?? null,
      };
    });

    return apiSuccess({
      items,
      totalCount,
      page,
      pageSize,
      pageCount: Math.ceil(totalCount / pageSize),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/ai-tasks] DB 오류:`, err);
    return apiError("DB_ERROR", "AI 태스크 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: AI 태스크 생성 ────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
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

  const { refTypeCode, refId, taskTypeCode, comment } = body as {
    refTypeCode?:  string;
    refId?:        string;
    taskTypeCode?: string;
    comment?:      string;
  };

  if (!refTypeCode || !["AREA", "FUNCTION"].includes(refTypeCode)) {
    return apiError("VALIDATION_ERROR", "refTypeCode는 AREA 또는 FUNCTION이어야 합니다.", 400);
  }
  if (!refId) {
    return apiError("VALIDATION_ERROR", "refId가 필요합니다.", 400);
  }
  if (!taskTypeCode || !["INSPECT", "DESIGN", "IMPLEMENT", "MOCKUP", "IMPACT", "CUSTOM"].includes(taskTypeCode)) {
    return apiError("VALIDATION_ERROR", "요청 유형을 선택해 주세요.", 400);
  }

  try {
    // 대상 엔티티 존재 확인 + 스냅샷 데이터 수집
    let snapshotData: object = { refId };

    if (refTypeCode === "AREA") {
      const area = await prisma.tbDsArea.findUnique({ where: { area_id: refId } });
      if (!area || area.prjct_id !== projectId) {
        return apiError("NOT_FOUND", "대상 영역을 찾을 수 없습니다.", 404);
      }
      snapshotData = { areaId: area.area_id, areaName: area.area_nm, areaType: area.area_ty_code, areaDesc: area.area_dc };
    } else {
      const fn = await prisma.tbDsFunction.findUnique({ where: { func_id: refId } });
      if (!fn || fn.prjct_id !== projectId) {
        return apiError("NOT_FOUND", "대상 기능을 찾을 수 없습니다.", 404);
      }
      snapshotData = { funcId: fn.func_id, funcName: fn.func_nm, funcType: fn.func_ty_code, funcDesc: fn.func_dc };
    }

    // 현재 버전은 PENDING 상태로 생성 (AI 파이프라인 미연동)
    const task = await prisma.tbAiTask.create({
      data: {
        prjct_id:         projectId,
        ref_ty_code:      refTypeCode,
        ref_id:           refId,
        task_ty_code:     taskTypeCode,
        coment_cn:        comment?.trim() || null,
        req_snapshot_data: snapshotData,
        req_mber_id:      auth.mberId,
        task_sttus_code:  "PENDING",
        retry_cnt:        0,
      },
    });

    return apiSuccess({ taskId: task.ai_task_id, status: "PENDING" }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/ai-tasks] DB 오류:`, err);
    return apiError("DB_ERROR", "요청 처리 중 오류가 발생했습니다.", 500);
  }
}
