/**
 * GET  /api/projects/[id]/tasks — 과업 목록 조회 (FID-00092)
 * POST /api/projects/[id]/tasks — 과업 생성 (FID-00097 신규)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { requireTaskWrite } from "@/lib/taskWriteGate";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 과업 목록 조회 ─────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  // 담당자 필터 — "me" 또는 mberId. URL 공유 가능
  const url        = new URL(request.url);
  const assignedTo = url.searchParams.get("assignedTo") ?? undefined;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  // assignedTo="me" → 로그인 사용자 mberId, 그 외 truthy 값은 그대로
  const assigneeFilter = assignedTo === "me" ? gate.mberId : (assignedTo || undefined);

  try {
    const tasks = await prisma.tbRqTask.findMany({
      where: {
        prjct_id: projectId,
        ...(assigneeFilter ? { asign_mber_id: assigneeFilter } : {}),
      },
      include: {
        requirements: {
          select: { req_id: true, priort_code: true },
        },
      },
      orderBy: [
        { task_display_id: "asc" },
        { creat_dt: "desc" },
      ],
    });

    // 담당자 mberId → 이름 배치 조회 (N+1 방지)
    const assigneeIds = [
      ...new Set(tasks.map((t) => t.asign_mber_id).filter((v): v is string => !!v)),
    ];
    const assigneeMembers = assigneeIds.length > 0
      ? await prisma.tbCmMember.findMany({
          where:  { mber_id: { in: assigneeIds } },
          // email_addr를 fallback으로 — mber_nm 미설정 계정도 식별 가능
          select: { mber_id: true, mber_nm: true, email_addr: true },
        })
      : [];
    const assigneeMap = new Map(assigneeMembers.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null]));

    const items = tasks.map((t) => {
      const reqs  = t.requirements;
      const high   = reqs.filter((r) => r.priort_code === "HIGH").length;
      const medium = reqs.filter((r) => r.priort_code === "MEDIUM").length;
      const low    = reqs.filter((r) => r.priort_code === "LOW").length;

      return {
        taskId:           t.task_id,
        displayId:        t.task_display_id,
        name:             t.task_nm,
        category:         t.ctgry_code,
        rfpPageNo:        t.rfp_page_no ?? "",
        outputInfo:       t.output_info_cn ?? "",
        // 담당자 — 미지정/퇴장 멤버면 null (프론트에서 "-" 처리)
        assignMemberId:   t.asign_mber_id ?? null,
        assignMemberName: t.asign_mber_id ? (assigneeMap.get(t.asign_mber_id) ?? null) : null,
        requirementCount: reqs.length,
        prioritySummary:  { high, medium, low },
        sortOrder:        t.sort_ordr,
      };
    });

    return apiSuccess({ tasks: items, totalCount: items.length });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/tasks] DB 오류:`, err);
    return apiError("DB_ERROR", "과업 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 과업 생성 ─────────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  // OWNER/ADMIN 역할 OR PM/PL 직무 — MEMBER 는 환경설정 MEMBER_TASK_UPT_PSBL_YN="Y" 일 때만 통과
  const gate = await requireTaskWrite(request, projectId);
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { name, category, definition, content, outputInfo, rfpPage, displayId: inputDisplayId } = body as {
    name?: string; category?: string;
    definition?: string; content?: string;
    outputInfo?: string; rfpPage?: string;
    displayId?: string;
  };

  if (!name?.trim()) return apiError("VALIDATION_ERROR", "과업명을 입력해 주세요.", 400);
  if (!category?.trim()) return apiError("VALIDATION_ERROR", "카테고리를 선택해 주세요.", 400);

  try {
    // 표시 ID: 사용자가 입력하면 그대로 사용, 미입력 시 자동 채번
    let displayId: string;
    if (inputDisplayId?.trim()) {
      displayId = inputDisplayId.trim();
    } else {
      const maxTask = await prisma.tbRqTask.findFirst({
        where: { prjct_id: projectId },
        orderBy: { task_display_id: "desc" },
        select: { task_display_id: true },
      });
      const nextSeq = maxTask
        ? (parseInt(maxTask.task_display_id.replace(/\D/g, "")) || 0) + 1
        : 1;
      displayId = `SFR-${String(nextSeq).padStart(5, "0")}`;
    }

    // sort_ordr: 마지막 + 1
    const maxSort = await prisma.tbRqTask.findFirst({
      where: { prjct_id: projectId },
      orderBy: { sort_ordr: "desc" },
      select: { sort_ordr: true },
    });
    const sortOrder = (maxSort?.sort_ordr ?? 0) + 1;

    const task = await prisma.tbRqTask.create({
      data: {
        prjct_id:        projectId,
        task_display_id: displayId,
        task_nm:         name.trim(),
        ctgry_code:      category,
        defn_cn:         definition?.trim() || null,
        dtl_cn:          content?.trim() || null,
        output_info_cn:  outputInfo?.trim() || null,
        rfp_page_no:     rfpPage?.trim() || null,
        sort_ordr:       sortOrder,
      },
    });

    return apiSuccess({ taskId: task.task_id, displayId: task.task_display_id }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/tasks] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}
