/**
 * GET   /api/projects/[id]/weekly-reports/[weeklyReportId] — 단건 조회 (AI 태스크 상태 폴링 포함)
 * PATCH /api/projects/[id]/weekly-reports/[weeklyReportId] — 초안 수동 편집 저장
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { apiTextLimitGuard } from "@/lib/constants/textLimits";
import type { WeeklyReport, AiTaskStatus } from "@/types/weeklyReport";

type RouteParams = { params: Promise<{ id: string; weeklyReportId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, weeklyReportId } = await params;
  const gate = await requirePermission(request, projectId, "weeklyReport.manage");
  if (gate instanceof Response) return gate;

  try {
    const row = await prisma.tbWrWeeklyReport.findFirst({
      where: { weekly_report_id: weeklyReportId, prjct_id: projectId },
    });
    if (!row) return apiError("NOT_FOUND", "주간보고를 찾을 수 없습니다.", 404);

    const member = await prisma.tbCmMember.findUnique({
      where:  { mber_id: row.creat_mber_id },
      select: { mber_nm: true, email_addr: true },
    });
    const task = row.ai_task_id
      ? await prisma.tbAiTask.findUnique({
          where:  { ai_task_id: row.ai_task_id },
          select: { task_sttus_code: true },
        })
      : null;

    const result: WeeklyReport = {
      weeklyReportId: row.weekly_report_id,
      weekStartDt:    row.week_start_dt.toISOString().slice(0, 10),
      draftCn:        row.draft_cn,
      perfCn:         row.perf_cn,
      planCn:         row.plan_cn,
      commentCn:      row.comment_cn,
      noteCn:         row.note_cn,
      aiTaskId:       row.ai_task_id,
      aiTaskStatus:   (task?.task_sttus_code as AiTaskStatus) ?? null,
      creatMberId:    row.creat_mber_id,
      creatMberNm:    member?.mber_nm || member?.email_addr || null,
      creatDt:        row.creat_dt.toISOString(),
      mdfcnDt:        row.mdfcn_dt ? row.mdfcn_dt.toISOString() : null,
    };

    return apiSuccess(result);
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/weekly-reports/${weeklyReportId}] DB 오류:`, err);
    return apiError("DB_ERROR", "주간보고 조회에 실패했습니다.", 500);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, weeklyReportId } = await params;
  const gate = await requirePermission(request, projectId, "weeklyReport.manage");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }
  const { draftCn, perfCn, planCn, commentCn, noteCn } = body as {
    draftCn?: string; perfCn?: string; planCn?: string; commentCn?: string; noteCn?: string;
  };
  if (draftCn === undefined && perfCn === undefined && planCn === undefined && commentCn === undefined && noteCn === undefined) {
    return apiError("VALIDATION_ERROR", "수정할 필드가 없습니다.", 400);
  }

  const limitErr = apiTextLimitGuard([
    ["description", draftCn],
    ["description", perfCn],
    ["description", planCn],
    ["description", commentCn],
    ["description", noteCn],
  ]);
  if (limitErr) return limitErr;

  try {
    const existing = await prisma.tbWrWeeklyReport.findFirst({
      where:  { weekly_report_id: weeklyReportId, prjct_id: projectId },
      select: { weekly_report_id: true },
    });
    if (!existing) return apiError("NOT_FOUND", "주간보고를 찾을 수 없습니다.", 404);

    await prisma.tbWrWeeklyReport.update({
      where: { weekly_report_id: weeklyReportId },
      data: {
        ...(draftCn  !== undefined ? { draft_cn:  draftCn }  : {}),
        ...(perfCn   !== undefined ? { perf_cn:   perfCn }   : {}),
        ...(planCn    !== undefined ? { plan_cn:    planCn }    : {}),
        ...(commentCn !== undefined ? { comment_cn: commentCn } : {}),
        ...(noteCn    !== undefined ? { note_cn:    noteCn }    : {}),
        mdfr_mber_id: gate.mberId,
        mdfcn_dt: new Date(),
      },
    });

    return apiSuccess({ weeklyReportId });
  } catch (err) {
    console.error(`[PATCH /api/projects/${projectId}/weekly-reports/${weeklyReportId}] DB 오류:`, err);
    return apiError("DB_ERROR", "주간보고 저장에 실패했습니다.", 500);
  }
}
