/**
 * GET  /api/projects/[id]/tasks — 과업 목록 조회 (FID-00092)
 * POST /api/projects/[id]/tasks — 과업 생성 (FID-00097 신규)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { getIdPrefix } from "@/lib/idPrefix";
import { computeNextDisplayId } from "@/lib/nextDisplayId";
import { apiTextLimitGuard } from "@/lib/constants/textLimits";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { taskCreateSchema } from "@/lib/specContentSchemas";
import { listMeaningfulFields } from "@/lib/specContentFieldPolicy";
import { requireSpecCreateFields } from "@/lib/specContentWritePolicy";
import { fetchProjectTasks } from "@/lib/exports/tasks-data";

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
  // (인증 컨텍스트는 라우트에서 풀고, service 에는 mberId 또는 undefined 만 넘김)
  const assigneeFilter = assignedTo === "me" ? gate.mberId : (assignedTo || undefined);

  try {
    // 데이터 조회+가공 로직은 service 로 분리 — export 라우트와 동일 결과 보장
    const items = await fetchProjectTasks({ projectId, assigneeFilter });
    return apiSuccess({ tasks: items, totalCount: items.length });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/tasks] DB 오류:`, err);
    return apiError("DB_ERROR", "과업 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 과업 생성 ─────────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  // VIEWER를 제외한 프로젝트 멤버는 스펙을 등록할 수 있다.
  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

  const parsed = await parseJsonBody(request, taskCreateSchema);
  if (parsed instanceof Response) return parsed;
  const { name, category, definition, content, outputInfo, rfpPage, displayId: inputDisplayId } = parsed.data;
  const fieldError = requireSpecCreateFields(gate, "TASK", listMeaningfulFields(parsed.data));
  if (fieldError) return fieldError;

  // 장문 텍스트 한도 검증 — 정책은 src/lib/constants/textLimits.ts
  // definition/content/outputInfo 모두 과업 본문 → taskDefinition 한도(50K)
  const limitErr = apiTextLimitGuard([
    ["name",           name],
    ["displayId",      inputDisplayId],
    ["taskDefinition", definition],
    ["taskDefinition", content],
    ["taskDefinition", outputInfo],
  ]);
  if (limitErr) return limitErr;

  try {
    // 표시 ID: 사용자가 입력하면 그대로 사용, 미입력 시 자동 채번
    let displayId: string;
    if (inputDisplayId?.trim()) {
      displayId = inputDisplayId.trim();
    } else {
      const taskPrefix = await getIdPrefix(projectId, "TASK");
      const existingTasks = await prisma.tbRqTask.findMany({
        where:  { prjct_id: projectId },
        select: { task_display_id: true },
      });
      displayId = computeNextDisplayId(existingTasks.map((t) => t.task_display_id), taskPrefix);
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
        creat_mber_id:   gate.mberId,
      },
    });

    return apiSuccess({ taskId: task.task_id, displayId: task.task_display_id }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/tasks] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}
