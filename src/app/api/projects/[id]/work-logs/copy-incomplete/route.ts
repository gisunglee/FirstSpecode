/**
 * POST /api/projects/[id]/work-logs/copy-incomplete — 전일 미완료 할일을 오늘로 복사
 *
 * 예전엔 주 단위로 통째 복사하는 "이전 주 불러오기"가 있었는데, 실제로는 그냥 어제 못 끝낸
 * 걸 오늘로 이어서 적는 용도가 더 많이 쓰인다는 판단으로 훨씬 작은 단위(하루, 미완료만)로
 * 바꿨다(2026-07-24c). `date`(대상 날짜)의 바로 전날 DAILY 로그에서 done_yn='N'인 순수
 * 할일 항목(ref_ty_code 없는 것)만 item_cn 그대로 복사한다. 전날 로그·미완료 항목이 없으면
 * copiedCount: 0으로 조용히 끝난다(에러 아님). 본인 일지만 대상.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { addDaysStr } from "@/lib/weekUtil";

type RouteParams = { params: Promise<{ id: string }> };

function isValidDateStr(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }
  const { date } = body as { date?: string };
  if (!isValidDateStr(date)) {
    return apiError("VALIDATION_ERROR", "date 형식이 올바르지 않습니다 (YYYY-MM-DD).", 400);
  }

  const prevDate = addDaysStr(date, -1);

  try {
    const prevLog = await prisma.tbWrWorkLog.findFirst({
      where: {
        prjct_id: projectId, creat_mber_id: gate.mberId, log_ty_code: "DAILY",
        log_dt: new Date(prevDate + "T00:00:00Z"),
      },
      include: {
        items: { where: { ref_ty_code: null, done_yn: "N" }, orderBy: { sort_ordr: "asc" } },
      },
    });

    if (!prevLog || prevLog.items.length === 0) {
      return apiSuccess({ copiedCount: 0 });
    }

    let copiedCount = 0;
    await prisma.$transaction(async (tx) => {
      let targetLog = await tx.tbWrWorkLog.findUnique({
        where: {
          prjct_id_creat_mber_id_log_ty_code_log_dt: {
            prjct_id: projectId, creat_mber_id: gate.mberId, log_ty_code: "DAILY",
            log_dt: new Date(date + "T00:00:00Z"),
          },
        },
        select: { work_log_id: true },
      });
      if (!targetLog) {
        targetLog = await tx.tbWrWorkLog.create({
          data: { prjct_id: projectId, creat_mber_id: gate.mberId, log_ty_code: "DAILY", log_dt: new Date(date + "T00:00:00Z") },
          select: { work_log_id: true },
        });
      }

      const maxSort = await tx.tbWrWorkLogItem.findFirst({
        where:   { work_log_id: targetLog.work_log_id },
        orderBy: { sort_ordr: "desc" },
        select:  { sort_ordr: true },
      });
      let nextSort = (maxSort?.sort_ordr ?? 0) + 1;

      for (const item of prevLog.items) {
        await tx.tbWrWorkLogItem.create({
          data: { work_log_id: targetLog.work_log_id, item_cn: item.item_cn, sort_ordr: nextSort++ },
        });
        copiedCount++;
      }
    });

    return apiSuccess({ copiedCount });
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/work-logs/copy-incomplete] DB 오류:`, err);
    return apiError("DB_ERROR", "전일 미완료 항목 복사에 실패했습니다.", 500);
  }
}
