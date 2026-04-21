/**
 * GET  /api/projects/[id]/requirements — 요구사항 목록 조회 (FID-00099)
 * POST /api/projects/[id]/requirements — 요구사항 생성 (FID-00103 신규)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 요구사항 목록 조회 ─────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    const requirements = await prisma.tbRqRequirement.findMany({
      where: { prjct_id: projectId },
      include: {
        task:   { select: { task_id: true, task_nm: true } },
        // 단위업무 수 집계 — 목록에 배지로 표시
        _count: { select: { unitWorks: true } },
      },
      orderBy: [
        { task: { sort_ordr: "asc" } },  // 과업 정렬순서 우선
        { sort_ordr: "asc" },             // 요구사항 정렬순서
      ],
    });

    const items = requirements.map((r) => ({
      requirementId: r.req_id,
      displayId:     r.req_display_id,
      name:          r.req_nm,
      priority:      r.priort_code,
      source:        r.src_code,
      taskId:        r.task_id ?? null,
      taskName:      r.task?.task_nm ?? "미분류",
      unitWorkCount: r._count.unitWorks,
      sortOrder:     r.sort_ordr,
    }));

    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/requirements] DB 오류:`, err);
    return apiError("DB_ERROR", "요구사항 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 요구사항 생성 ─────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const {
    taskId, name, priority, source, rfpPage,
    originalContent, currentContent, analysisMemo, detailSpec,
  } = body as {
    taskId?: string; name?: string; priority?: string; source?: string;
    rfpPage?: string; originalContent?: string; currentContent?: string;
    analysisMemo?: string; detailSpec?: string;
  };

  if (!name?.trim()) return apiError("VALIDATION_ERROR", "요구사항명을 입력해 주세요.", 400);
  if (!priority) return apiError("VALIDATION_ERROR", "우선순위를 선택해 주세요.", 400);
  if (!source) return apiError("VALIDATION_ERROR", "출처를 선택해 주세요.", 400);

  try {
    // 표시 ID 채번 (REQ-NNNNN)
    const maxReq = await prisma.tbRqRequirement.findFirst({
      where: { prjct_id: projectId },
      orderBy: { req_display_id: "desc" },
      select: { req_display_id: true },
    });
    const nextSeq = maxReq
      ? (parseInt(maxReq.req_display_id.replace(/\D/g, "")) || 0) + 1
      : 1;
    const displayId = `REQ-${String(nextSeq).padStart(5, "0")}`;

    // sort_ordr: 마지막 + 1
    const maxSort = await prisma.tbRqRequirement.findFirst({
      where: { prjct_id: projectId },
      orderBy: { sort_ordr: "desc" },
      select: { sort_ordr: true },
    });

    const req = await prisma.tbRqRequirement.create({
      data: {
        prjct_id:       projectId,
        task_id:        taskId || null,
        req_display_id: displayId,
        req_nm:         name.trim(),
        priort_code:    priority,
        src_code:       source,
        rfp_page_no:    rfpPage?.trim() || null,
        orgnl_cn:       originalContent?.trim() || null,
        curncy_cn:      currentContent?.trim() || null,
        analy_cn:       analysisMemo?.trim() || null,
        spec_cn:        detailSpec?.trim() || null,
        sort_ordr:      (maxSort?.sort_ordr ?? 0) + 1,
      },
    });

    return apiSuccess({ requirementId: req.req_id, displayId: req.req_display_id }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/requirements] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}
