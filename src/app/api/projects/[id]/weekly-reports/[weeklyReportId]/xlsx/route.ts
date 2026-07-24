/**
 * GET /api/projects/[id]/weekly-reports/[weeklyReportId]/xlsx
 *   — 리더 리포트 "인쇄 미리보기"와 같은 내용을 엑셀로 다운로드
 *
 * 화면(PrintPreviewModal)이 보여주는 값을 그대로 재사용 — 별도 집계·가공 없음.
 * 이슈는 화면과 동일하게 rpt_yn='Y' 만, 정렬도 화면 기본값(sort_ordr asc)과 맞춘다.
 *
 * 권한: weeklyReport.manage — 리더 리포트 전체와 동일 권한(".read"가 아니므로 지원 세션에서는
 * 자동 차단되어 별도 export 권한을 새로 만들 필요가 없다).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiError } from "@/lib/apiResponse";
import { addDaysStr, getWeekMondayStr, mmddRange } from "@/lib/weekUtil";
import { filenameSafe } from "@/lib/exports/filename";
import { buildLeaderReportXlsx, type LeaderReportXlsxIssue } from "@/lib/exports/xlsx/leader-report";
import { ISSUE_CATEGORY_LABEL, ISSUE_STATUS_LABEL, type IssueCategoryCode, type IssueStatusCode } from "@/types/issue";

type RouteParams = { params: Promise<{ id: string; weeklyReportId: string }> };

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const WEEKDAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

function formatKoreanDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${WEEKDAY_LABEL[d.getUTCDay()]}요일`;
}

// PrintPreviewModal.computeWeekIndex 와 동일 로직 — 화면과 다른 주차 숫자가 나오면 안 됨
function computeWeekIndex(bgngDt: string | null, monday: string): number | null {
  if (!bgngDt) return null;
  const projectStartMonday = getWeekMondayStr(bgngDt.slice(0, 10));
  const diffDays = Math.round(
    (new Date(monday + "T00:00:00Z").getTime() - new Date(projectStartMonday + "T00:00:00Z").getTime()) /
      (1000 * 60 * 60 * 24)
  );
  return Math.floor(diffDays / 7) + 1;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, weeklyReportId } = await params;
  const gate = await requirePermission(request, projectId, "weeklyReport.manage");
  if (gate instanceof Response) return gate;

  try {
    const report = await prisma.tbWrWeeklyReport.findFirst({
      where: { weekly_report_id: weeklyReportId, prjct_id: projectId },
    });
    if (!report) return apiError("NOT_FOUND", "주간보고를 찾을 수 없습니다.", 404);

    const [project, issueRows] = await Promise.all([
      prisma.tbPjProject.findUnique({
        where:  { prjct_id: projectId },
        select: { prjct_nm: true, prjct_abrv: true, bgng_de: true },
      }),
      prisma.tbWrIssue.findMany({
        where:   { prjct_id: projectId, rpt_yn: "Y" },
        orderBy: { sort_ordr: "asc" },
      }),
    ]);

    const monday     = report.week_start_dt.toISOString().slice(0, 10);
    const sunday     = addDaysStr(monday, 6);
    const nextMonday = addDaysStr(monday, 7);
    const nextSunday = addDaysStr(monday, 13);
    const weekIndex = computeWeekIndex(project?.bgng_de ? project.bgng_de.toISOString().slice(0, 10) : null, monday);
    const weekLabel = weekIndex !== null ? `${weekIndex}주차 (${mmddRange(monday, sunday)})` : mmddRange(monday, sunday);

    const issues: LeaderReportXlsxIssue[] = issueRows.map((r) => ({
      categoryLabel: ISSUE_CATEGORY_LABEL[r.category_code as IssueCategoryCode] ?? r.category_code,
      cn:            r.cn || "-",
      actionCn:      r.action_cn || "-",
      requesterNm:   r.requester_nm || "-",
      assigneeNm:    r.assignee_nm || "-",
      reqDt:         r.req_dt ? r.req_dt.toISOString().slice(0, 10) : "-",
      dueDt:         r.due_dt ? r.due_dt.toISOString().slice(0, 10) : "-",
      statusLabel:   ISSUE_STATUS_LABEL[r.status_code as IssueStatusCode] ?? r.status_code,
    }));

    const projectName = project?.prjct_nm ?? "프로젝트";
    const buffer = await buildLeaderReportXlsx({
      projectName,
      weekLabel,
      reportDateLabel: formatKoreanDate(new Date().toISOString().slice(0, 10)),
      thisWeekRangeLabel: mmddRange(monday, sunday),
      nextWeekRangeLabel: mmddRange(nextMonday, nextSunday),
      issues,
      perfCn:    report.perf_cn ?? "",
      planCn:    report.plan_cn ?? "",
      commentCn: report.comment_cn ?? "",
      noteCn:    report.note_cn ?? "",
    });

    const abbrPrefix = filenameSafe(project?.prjct_abrv ?? null);
    const namePart    = abbrPrefix || filenameSafe(projectName);
    const filename = `${namePart}_주간업무보고서_${monday}~${sunday}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":        MIME_XLSX,
        "Content-Length":      buffer.length.toString(),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control":       "private, no-cache",
      },
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/weekly-reports/${weeklyReportId}/xlsx] 오류:`, err);
    return apiError("EXPORT_ERROR", "주간업무보고서(엑셀) 생성에 실패했습니다.", 500);
  }
}
