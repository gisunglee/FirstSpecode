/**
 * PATCH  /api/projects/[id]/work-logs/[workLogId]/items/[itemId] — 완료 토글 / 내용 수정
 * DELETE /api/projects/[id]/work-logs/[workLogId]/items/[itemId] — 삭제
 *
 * 본인 업무일지의 항목만 수정·삭제 가능 (PM/OWNER 라도 남의 일지는 못 건드림 — 개인 일지 성격).
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { apiTextLimitGuard } from "@/lib/constants/textLimits";

type RouteParams = { params: Promise<{ id: string; workLogId: string; itemId: string }> };

async function loadOwnedItem(projectId: string, workLogId: string, itemId: string, mberId: string) {
  const item = await prisma.tbWrWorkLogItem.findFirst({
    where:  { item_id: itemId, work_log_id: workLogId },
    select: { item_id: true, workLog: { select: { prjct_id: true, creat_mber_id: true } } },
  });
  if (!item || item.workLog.prjct_id !== projectId) return { ok: false as const, status: 404 };
  if (item.workLog.creat_mber_id !== mberId) return { ok: false as const, status: 403 };
  return { ok: true as const };
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, workLogId, itemId } = await params;
  const gate = await requirePermission(request, projectId, "content.update");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }
  const { doneYn, itemCn } = body as { doneYn?: string; itemCn?: string };

  if (doneYn !== undefined && doneYn !== "Y" && doneYn !== "N") {
    return apiError("VALIDATION_ERROR", "doneYn은 Y 또는 N이어야 합니다.", 400);
  }
  if (itemCn !== undefined && !itemCn.trim()) {
    return apiError("VALIDATION_ERROR", "할일 내용을 입력해 주세요.", 400);
  }

  const limitErr = apiTextLimitGuard([["name", itemCn]]);
  if (limitErr) return limitErr;

  try {
    const owned = await loadOwnedItem(projectId, workLogId, itemId, gate.mberId);
    if (!owned.ok) {
      return owned.status === 404
        ? apiError("NOT_FOUND", "할일 항목을 찾을 수 없습니다.", 404)
        : apiError("FORBIDDEN", "본인 업무일지의 항목만 수정할 수 있습니다.", 403);
    }

    await prisma.tbWrWorkLogItem.update({
      where: { item_id: itemId },
      data: {
        ...(doneYn !== undefined ? { done_yn: doneYn } : {}),
        ...(itemCn !== undefined ? { item_cn: itemCn.trim() } : {}),
      },
    });

    return apiSuccess({ itemId });
  } catch (err) {
    console.error(`[PATCH /api/projects/${projectId}/work-logs/${workLogId}/items/${itemId}] DB 오류:`, err);
    return apiError("DB_ERROR", "할일 항목 수정에 실패했습니다.", 500);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, workLogId, itemId } = await params;
  const gate = await requirePermission(request, projectId, "content.delete");
  if (gate instanceof Response) return gate;

  try {
    const owned = await loadOwnedItem(projectId, workLogId, itemId, gate.mberId);
    if (!owned.ok) {
      return owned.status === 404
        ? apiError("NOT_FOUND", "할일 항목을 찾을 수 없습니다.", 404)
        : apiError("FORBIDDEN", "본인 업무일지의 항목만 삭제할 수 있습니다.", 403);
    }

    await prisma.tbWrWorkLogItem.delete({ where: { item_id: itemId } });

    return apiSuccess({ itemId });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/work-logs/${workLogId}/items/${itemId}] DB 오류:`, err);
    return apiError("DB_ERROR", "할일 항목 삭제에 실패했습니다.", 500);
  }
}
