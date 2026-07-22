/**
 * GET /api/projects/[id]/weekly-reports/export-md — "AI에게 보내는 내용" 그대로 MD 내보내기
 *
 * 실제 "AI 초안 생성"(POST /weekly-reports)이 TbAiTask.req_cn 으로 만들어 보내는 것과 완전히
 * 동일한 텍스트를 그대로 반환한다(buildWeeklyReportPrompt 공유). 팀 내 AI 태스크 큐를 거치지
 * 않고, 사용자가 이 내용을 복사해서 개인적으로 Claude 등에 붙여넣어 직접 요청할 수 있게 한다.
 *
 * 쿼리: weekStartDt=YYYY-MM-DD (필수, 월요일 아니어도 자동 정규화)
 * 권한: weeklyReport.manage — 초안 생성과 동일한 PM 전용 데이터이므로 조회도 같은 권한.
 */

import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { getWeekMondayStr } from "@/lib/weekUtil";
import { buildWeeklyReportPrompt } from "@/lib/weeklyReportPrompt";

type RouteParams = { params: Promise<{ id: string }> };

function isValidDateStr(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(request, projectId, "weeklyReport.manage");
  if (gate instanceof Response) return gate;

  const weekStartDt = new URL(request.url).searchParams.get("weekStartDt");
  if (!isValidDateStr(weekStartDt)) {
    return apiError("VALIDATION_ERROR", "weekStartDt 형식이 올바르지 않습니다 (YYYY-MM-DD).", 400);
  }

  const weekStart = getWeekMondayStr(weekStartDt);

  try {
    const { finalReqCn } = await buildWeeklyReportPrompt(projectId, weekStart);
    return apiSuccess({ weekStart, md: finalReqCn });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/weekly-reports/export-md] DB 오류:`, err);
    return apiError("DB_ERROR", "MD 내보내기에 실패했습니다.", 500);
  }
}
