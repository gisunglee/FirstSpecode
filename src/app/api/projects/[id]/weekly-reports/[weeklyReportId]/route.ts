/**
 * GET /api/projects/[id]/weekly-reports/[weeklyReportId] — 단건 조회 (AI 태스크 상태 폴링 포함)
 *
 * 수정은 여기가 아니라 PATCH /api/projects/[id]/weekly-reports (weekStartDt 기준, 행이
 * 없으면 자동 생성)로 옮겼다 — PM이 AI를 한 번도 요청하지 않은 주에도 금주 실적 등을 바로
 * 적을 수 있어야 하는데, 이 라우트는 weeklyReportId가 있어야만 호출 가능해서 그 경우를
 * 처리할 수 없었다(2026-07-23).
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
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
