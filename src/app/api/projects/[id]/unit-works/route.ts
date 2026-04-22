/**
 * GET  /api/projects/[id]/unit-works — 단위업무 목록 조회 (FID-00129)
 * POST /api/projects/[id]/unit-works — 단위업무 생성 (FID-00130 신규)
 *
 * Query: reqId? — 특정 요구사항의 단위업무만 조회 (없으면 프로젝트 전체)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 단위업무 목록 조회 ─────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const url   = new URL(request.url);
  const reqId = url.searchParams.get("reqId") ?? undefined;
  // 담당자 필터 — "me"는 로그인 사용자, 그 외 값은 해당 mberId로 필터
  // URL 공유를 위해 서버 쿼리 파라미터로 설계 (클라이언트 필터 대신)
  const assignedTo = url.searchParams.get("assignedTo") ?? undefined;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  // assignedTo="me" → 로그인 사용자 mberId로 치환, 그 외 truthy 값은 그대로 사용
  const assigneeFilter = assignedTo === "me" ? gate.mberId : (assignedTo || undefined);

  try {
    const unitWorks = await prisma.tbDsUnitWork.findMany({
      where: {
        prjct_id: projectId,
        // reqId 있으면 해당 요구사항으로 필터
        ...(reqId ? { req_id: reqId } : {}),
        // assignedTo 있으면 담당자로 필터
        ...(assigneeFilter ? { asign_mber_id: assigneeFilter } : {}),
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

    // 담당자 mberId → 이름 매핑용 — null/중복 제거
    const assigneeIds = [
      ...new Set(unitWorks.map((u) => u.asign_mber_id).filter((v): v is string => !!v)),
    ];

    // 진척률 + IMPLEMENT 스냅샷 + 담당자 이름을 병렬 조회 (N+1 방지)
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
            // email_addr를 fallback으로 — mber_nm 미설정 계정도 식별 가능
            select: { mber_id: true, mber_nm: true, email_addr: true },
          })
        : Promise.resolve([]),
    ]);
    const progressMap = new Map(progressRecords.map((p) => [p.ref_id, p]));
    // 담당자 이름 맵 — 이름 우선, 없으면 이메일, 둘 다 없으면 null
    const assigneeMap = new Map(assigneeMembers.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null]));

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
        assignMemberId:   uw.asign_mber_id ?? null,
        // 담당자 이름 — 없거나 퇴장한 멤버면 null (프론트에서 "-" 처리)
        assignMemberName: uw.asign_mber_id ? (assigneeMap.get(uw.asign_mber_id) ?? null) : null,
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
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { reqId, name, displayId: inputDisplayId, description, assignMemberId, startDate, endDate } = body as {
    reqId?:          string;
    name?:           string;
    displayId?:      string;
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
    // 표시 ID — 사용자 입력이 있으면 그대로 사용, 없으면 자동 채번 (UW-NNNNN)
    let displayId: string;
    if (inputDisplayId?.trim()) {
      displayId = inputDisplayId.trim();
    } else {
      const maxUw = await prisma.tbDsUnitWork.findFirst({
        where:   { prjct_id: projectId },
        orderBy: { unit_work_display_id: "desc" },
        select:  { unit_work_display_id: true },
      });
      const nextSeq = maxUw
        ? (parseInt(maxUw.unit_work_display_id.replace(/\D/g, "")) || 0) + 1
        : 1;
      displayId = `UW-${String(nextSeq).padStart(5, "0")}`;
    }

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
