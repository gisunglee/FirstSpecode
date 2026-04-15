/**
 * GET  /api/projects/[id]/unit-works — 단위업무 목록 조회 (FID-00129)
 * POST /api/projects/[id]/unit-works — 단위업무 생성 (FID-00130 신규)
 *
 * Query: reqId? — 특정 요구사항의 단위업무만 조회 (없으면 프로젝트 전체)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 단위업무 목록 조회 ─────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;
  const url   = new URL(request.url);
  const reqId = url.searchParams.get("reqId") ?? undefined;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const unitWorks = await prisma.tbDsUnitWork.findMany({
      where: {
        prjct_id: projectId,
        // reqId 있으면 해당 요구사항으로 필터
        ...(reqId ? { req_id: reqId } : {}),
      },
      include: {
        requirement: { select: { req_id: true, req_display_id: true, req_nm: true } },
        screens:     { select: { scrn_id: true } },
      },
      orderBy: [
        { requirement: { sort_ordr: "asc" } },  // 요구사항 정렬순서 우선
        { sort_ordr: "asc" },                    // 단위업무 정렬순서
      ],
    });

    const unitWorkIds = unitWorks.map((uw) => uw.unit_work_id);

    // 진척률 + IMPLEMENT 스냅샷을 병렬 조회 (N+1 방지)
    const [progressRecords, implSnapshots] = await Promise.all([
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
    ]);
    const progressMap = new Map(progressRecords.map((p) => [p.ref_id, p]));

    // ── 단위업무별 IMPLEMENT 태스크 최신 1건 매핑 ────────────────────────
    // 스냅샷 → ai_task_id 수집 → tbAiTask 일괄 조회 (taskType=IMPLEMENT) → 단위업무별 최신 1건
    const implTaskMap = new Map<string, { aiTaskId: string; status: string; requestedAt: Date }>();
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

    const items = unitWorks.map((uw) => {
      const prog = progressMap.get(uw.unit_work_id);
      const impl = implTaskMap.get(uw.unit_work_id);
      return {
        unitWorkId:    uw.unit_work_id,
        displayId:     uw.unit_work_display_id,
        name:          uw.unit_work_nm,
        description:   uw.unit_work_dc ?? "",
        assignMemberId: uw.asign_mber_id ?? null,
        startDate:     uw.bgng_de ?? null,
        endDate:       uw.end_de ?? null,
        progress:      uw.progrs_rt,
        sortOrder:     uw.sort_ordr,
        reqId:         uw.req_id,
        reqDisplayId:  uw.requirement.req_display_id,
        reqName:       uw.requirement.req_nm,
        screenCount:   uw.screens.length,
        analyRt:       prog?.analy_rt  ?? 0,
        designRt:      prog?.design_rt ?? 0,
        implRt:        prog?.impl_rt   ?? 0,
        testRt:        prog?.test_rt   ?? 0,
        // AI 구현 요청 정보 (스냅샷 → IMPLEMENT 태스크 최신 1건)
        implTask:      impl ? { aiTaskId: impl.aiTaskId, status: impl.status, requestedAt: impl.requestedAt } : null,
      };
    });

    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/unit-works] DB 오류:`, err);
    return apiError("DB_ERROR", "단위업무 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 단위업무 생성 ─────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
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

  const { reqId, name, description, assignMemberId, startDate, endDate } = body as {
    reqId?:          string;
    name?:           string;
    description?:    string;
    assignMemberId?: string;
    startDate?:      string;
    endDate?:        string;
  };

  if (!reqId?.trim())  return apiError("VALIDATION_ERROR", "상위 요구사항을 선택해 주세요.", 400);
  if (!name?.trim())   return apiError("VALIDATION_ERROR", "단위업무명을 입력해 주세요.", 400);

  // 요구사항이 이 프로젝트에 속하는지 확인 (보안: 다른 프로젝트 요구사항 연결 차단)
  const req = await prisma.tbRqRequirement.findUnique({ where: { req_id: reqId } });
  if (!req || req.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "요구사항을 찾을 수 없습니다.", 404);
  }

  try {
    // 표시 ID 채번 (UW-NNNNN)
    const maxUw = await prisma.tbDsUnitWork.findFirst({
      where:   { prjct_id: projectId },
      orderBy: { unit_work_display_id: "desc" },
      select:  { unit_work_display_id: true },
    });
    const nextSeq = maxUw
      ? (parseInt(maxUw.unit_work_display_id.replace(/\D/g, "")) || 0) + 1
      : 1;
    const displayId = `UW-${String(nextSeq).padStart(5, "0")}`;

    // sort_ordr: 해당 요구사항 내 마지막 + 1
    const maxSort = await prisma.tbDsUnitWork.findFirst({
      where:   { req_id: reqId },
      orderBy: { sort_ordr: "desc" },
      select:  { sort_ordr: true },
    });

    const unitWork = await prisma.tbDsUnitWork.create({
      data: {
        prjct_id:             projectId,
        req_id:               reqId,
        unit_work_display_id: displayId,
        unit_work_nm:         name.trim(),
        unit_work_dc:         description?.trim() || null,
        asign_mber_id:        assignMemberId || null,
        bgng_de:              startDate?.trim() || null,
        end_de:               endDate?.trim() || null,
        sort_ordr:            (maxSort?.sort_ordr ?? 0) + 1,
      },
    });

    return apiSuccess({ unitWorkId: unitWork.unit_work_id, displayId: unitWork.unit_work_display_id }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/unit-works] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}
