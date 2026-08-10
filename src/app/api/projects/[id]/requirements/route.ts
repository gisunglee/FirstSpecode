/**
 * GET  /api/projects/[id]/requirements — 요구사항 목록 조회 (FID-00099)
 * POST /api/projects/[id]/requirements — 요구사항 생성 (FID-00103 신규)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { getIdPrefix } from "@/lib/idPrefix";
import { apiTextLimitGuard } from "@/lib/constants/textLimits";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { requirementCreateSchema } from "@/lib/specContentSchemas";
import { listMeaningfulFields } from "@/lib/specContentFieldPolicy";
import { requireSpecCreateFields } from "@/lib/specContentWritePolicy";
import { fetchProjectRequirements } from "@/lib/exports/requirements-data";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 요구사항 목록 조회 ─────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  // 담당자 필터 — "me" 또는 mberId
  const url        = new URL(request.url);
  const assignedTo = url.searchParams.get("assignedTo") ?? undefined;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const assigneeFilter = assignedTo === "me" ? gate.mberId : (assignedTo || undefined);

  try {
    // 데이터 조회+가공 로직은 service 로 분리 — export 라우트와 동일 결과 보장
    const items = await fetchProjectRequirements({ projectId, assigneeFilter });
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

  const parsed = await parseJsonBody(request, requirementCreateSchema);
  if (parsed instanceof Response) return parsed;
  const {
    taskId, name, priority, source, rfpPage,
    originalContent, currentContent, analysisMemo, detailSpec,
  } = parsed.data;
  const fieldError = requireSpecCreateFields(gate, "REQUIREMENT", listMeaningfulFields(parsed.data));
  if (fieldError) return fieldError;

  if (taskId) {
    const parentTask = await prisma.tbRqTask.findFirst({
      where: { task_id: taskId, prjct_id: projectId },
      select: { task_id: true },
    });
    if (!parentTask) return apiError("NOT_FOUND", "과업을 찾을 수 없습니다.", 404);
  }

  // 장문 텍스트 한도 검증 — 정책은 src/lib/constants/textLimits.ts
  // orgnl/curncy 는 RichEditor HTML 출력 → htmlContent 한도(100K) 적용
  const limitErr = apiTextLimitGuard([
    ["name",         name],
    ["htmlContent",  originalContent],
    ["htmlContent",  currentContent],
    ["analysisMemo", analysisMemo],
    ["detailSpec",   detailSpec],
  ]);
  if (limitErr) return limitErr;

  try {
    // 표시 ID 채번 — prefix 는 프로젝트 환경설정에서 조회
    const maxReq = await prisma.tbRqRequirement.findFirst({
      where: { prjct_id: projectId },
      orderBy: { req_display_id: "desc" },
      select: { req_display_id: true },
    });
    const nextSeq = maxReq
      ? (parseInt(maxReq.req_display_id.replace(/\D/g, "")) || 0) + 1
      : 1;
    const reqPrefix = await getIdPrefix(projectId, "REQUIREMENT");
    const displayId = `${reqPrefix}-${String(nextSeq).padStart(5, "0")}`;

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
        creat_mber_id:  gate.mberId,
      },
    });

    return apiSuccess({ requirementId: req.req_id, displayId: req.req_display_id }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/requirements] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}
