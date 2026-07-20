/**
 * POST /api/projects/[id]/work-logs/[workLogId]/items — 오늘 할일 항목 추가
 *
 * 두 가지 입력 방식:
 *   - 자유 텍스트: { itemCn }
 *   - 일감 연결:   { refTyCode, refId } — 대상 엔티티명을 조회해 itemCn 스냅샷으로 채움
 *                  (연결이 끊겨도(추후 삭제) 항목 내용은 남아야 하므로 스냅샷 저장)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { apiTextLimitGuard } from "@/lib/constants/textLimits";
import type { WorkLogItemRefType } from "@/types/workLog";

type RouteParams = { params: Promise<{ id: string; workLogId: string }> };

const REF_TYPES: readonly WorkLogItemRefType[] = ["UNIT_WORK", "SCREEN", "FUNCTION", "TASK"];

// 일감 연결 시 해당 엔티티의 표시 이름을 조회 — 없으면 null(자유 텍스트로 대체)
async function resolveRefName(
  projectId: string,
  refTyCode: WorkLogItemRefType,
  refId: string
): Promise<string | null> {
  switch (refTyCode) {
    case "UNIT_WORK": {
      const row = await prisma.tbDsUnitWork.findFirst({
        where: { unit_work_id: refId, prjct_id: projectId },
        select: { unit_work_display_id: true, unit_work_nm: true },
      });
      return row ? `[${row.unit_work_display_id}] ${row.unit_work_nm}` : null;
    }
    case "SCREEN": {
      const row = await prisma.tbDsScreen.findFirst({
        where: { scrn_id: refId, prjct_id: projectId },
        select: { scrn_display_id: true, scrn_nm: true },
      });
      return row ? `[${row.scrn_display_id}] ${row.scrn_nm}` : null;
    }
    case "FUNCTION": {
      const row = await prisma.tbDsFunction.findFirst({
        where: { func_id: refId, prjct_id: projectId },
        select: { func_display_id: true, func_nm: true },
      });
      return row ? `[${row.func_display_id}] ${row.func_nm}` : null;
    }
    case "TASK": {
      const row = await prisma.tbRqTask.findFirst({
        where: { task_id: refId, prjct_id: projectId },
        select: { task_display_id: true, task_nm: true },
      });
      return row ? `[${row.task_display_id}] ${row.task_nm}` : null;
    }
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, workLogId } = await params;
  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { itemCn, refTyCode, refId } = body as {
    itemCn?: string; refTyCode?: string; refId?: string;
  };

  const isLinked = !!refTyCode && !!refId;
  if (isLinked && !REF_TYPES.includes(refTyCode as WorkLogItemRefType)) {
    return apiError("VALIDATION_ERROR", "refTyCode는 UNIT_WORK/SCREEN/FUNCTION/TASK 중 하나여야 합니다.", 400);
  }
  if (!isLinked && !itemCn?.trim()) {
    return apiError("VALIDATION_ERROR", "할일 내용을 입력해 주세요.", 400);
  }

  const limitErr = apiTextLimitGuard([["name", itemCn]]);
  if (limitErr) return limitErr;

  try {
    // 본인 일지에만 항목을 추가할 수 있음
    const workLog = await prisma.tbWrWorkLog.findFirst({
      where:  { work_log_id: workLogId, prjct_id: projectId },
      select: { creat_mber_id: true },
    });
    if (!workLog) return apiError("NOT_FOUND", "업무일지를 찾을 수 없습니다.", 404);
    if (workLog.creat_mber_id !== gate.mberId) {
      return apiError("FORBIDDEN", "본인 업무일지에만 항목을 추가할 수 있습니다.", 403);
    }

    let finalItemCn = itemCn?.trim() || "";
    if (isLinked) {
      const resolved = await resolveRefName(projectId, refTyCode as WorkLogItemRefType, refId as string);
      if (!resolved) return apiError("NOT_FOUND", "연결하려는 일감을 찾을 수 없습니다.", 404);
      finalItemCn = resolved;
    }

    const maxSort = await prisma.tbWrWorkLogItem.findFirst({
      where:   { work_log_id: workLogId },
      orderBy: { sort_ordr: "desc" },
      select:  { sort_ordr: true },
    });

    const item = await prisma.tbWrWorkLogItem.create({
      data: {
        work_log_id: workLogId,
        item_cn:     finalItemCn,
        ref_ty_code: isLinked ? refTyCode : null,
        ref_id:      isLinked ? refId     : null,
        sort_ordr:   (maxSort?.sort_ordr ?? 0) + 1,
      },
    });

    return apiSuccess({ itemId: item.item_id }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/work-logs/${workLogId}/items] DB 오류:`, err);
    return apiError("DB_ERROR", "할일 항목 추가에 실패했습니다.", 500);
  }
}
