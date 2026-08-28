/**
 * GET  /api/projects/[id]/requirements — 요구사항 목록 조회 (FID-00099)
 * POST /api/projects/[id]/requirements — 요구사항 생성 (FID-00103 신규)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { getIdPrefix } from "@/lib/idPrefix";
import { computeNextDisplayId } from "@/lib/nextDisplayId";
import { apiTextLimitGuard } from "@/lib/constants/textLimits";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { requirementCreateSchema } from "@/lib/specContentSchemas";
import { listMeaningfulFields } from "@/lib/specContentFieldPolicy";
import { requireSpecCreateFields } from "@/lib/specContentWritePolicy";
import { fetchProjectRequirements } from "@/lib/exports/requirements-data";
import { applyTemplateVars } from "@/lib/templateVars";

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
    taskId, name, displayId: inputDisplayId, priority, source, rfpPage,
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
    ["displayId",    inputDisplayId],
    ["htmlContent",  originalContent],
    ["htmlContent",  currentContent],
    ["analysisMemo", analysisMemo],
    ["detailSpec",   detailSpec],
  ]);
  if (limitErr) return limitErr;

  try {
    // 표시 ID — 사용자 입력이 있으면 그대로 사용, 없으면 자동 채번 (prefix는 프로젝트 환경설정에서 조회)
    let displayId: string;
    if (inputDisplayId?.trim()) {
      displayId = inputDisplayId.trim();
    } else {
      const reqPrefix = await getIdPrefix(projectId, "REQUIREMENT");
      const existingReqs = await prisma.tbRqRequirement.findMany({
        where:  { prjct_id: projectId },
        select: { req_display_id: true },
      });
      displayId = computeNextDisplayId(existingReqs.map((r) => r.req_display_id), reqPrefix);
    }

    // sort_ordr: 마지막 + 1
    const maxSort = await prisma.tbRqRequirement.findFirst({
      where: { prjct_id: projectId },
      orderBy: { sort_ordr: "desc" },
      select: { sort_ordr: true },
    });

    // 템플릿 플레이스홀더({{displayId}}/{{name}}) 안전망 — MCP 등 "템플릿 삽입" 버튼을
    // 거치지 않는 경로로 저장될 때도 실제 값으로 치환되도록 저장 직전에 한 번 더 통과시킴.
    // 요구사항 표준 양식엔 이 토큰이 없어 오늘은 no-op이지만, 다른 계층과 동일하게 맞춰둔다.
    const trimmedDetailSpec = detailSpec?.trim() || null;
    const newDetailSpec = trimmedDetailSpec
      ? applyTemplateVars(trimmedDetailSpec, { displayId, name: name.trim() })
      : trimmedDetailSpec;

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
        spec_cn:        newDetailSpec,
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
