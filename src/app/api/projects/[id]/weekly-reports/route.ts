/**
 * GET  /api/projects/[id]/weekly-reports — 주간보고 이력 목록 (최신 주부터)
 * POST /api/projects/[id]/weekly-reports — 초안 생성/재생성 요청
 *
 * 권한: weeklyReport.manage (OWNER/ADMIN 역할 또는 PM/PL 직무) — PM 전용 기능이라
 * work-logs 와 달리 조회도 이 권한으로 게이트.
 *
 * 생성 흐름: 그 주(월~일) 전체 팀원의 TbWrWorkLog(DAILY)+항목을 모아 프롬프트를 조립하고
 * TbAiTask(PENDING)를 생성한다. 실제 처리는 기존 AI 태스크 큐와 동일하게
 * `/run-ai-tasks` 가 담당 — worker complete 라우트의 applyResultToRef(WEEKLY_REPORT)가
 * 결과를 TbWrWeeklyReport.draft_cn 에 자동 반영한다.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { getWeekMondayStr, addDaysStr } from "@/lib/weekUtil";
import { buildWeeklyReportPrompt } from "@/lib/weeklyReportPrompt";
import type { WeeklyReport, AiTaskStatus } from "@/types/weeklyReport";

type RouteParams = { params: Promise<{ id: string }> };

const HISTORY_LIMIT = 30;

function isValidDateStr(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// ─── GET: 이력 목록 ──────────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(request, projectId, "weeklyReport.manage");
  if (gate instanceof Response) return gate;

  try {
    const rows = await prisma.tbWrWeeklyReport.findMany({
      where:   { prjct_id: projectId },
      orderBy: { week_start_dt: "desc" },
      take:    HISTORY_LIMIT,
    });

    const mberIds = [...new Set(rows.map((r) => r.creat_mber_id))];
    const members = mberIds.length > 0
      ? await prisma.tbCmMember.findMany({
          where:  { mber_id: { in: mberIds } },
          select: { mber_id: true, mber_nm: true, email_addr: true },
        })
      : [];
    const nameMap = new Map(members.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null]));

    const taskIds = rows.map((r) => r.ai_task_id).filter((v): v is string => !!v);
    const tasks = taskIds.length > 0
      ? await prisma.tbAiTask.findMany({
          where:  { ai_task_id: { in: taskIds } },
          select: { ai_task_id: true, task_sttus_code: true },
        })
      : [];
    const statusMap = new Map(tasks.map((t) => [t.ai_task_id, t.task_sttus_code as AiTaskStatus]));

    const items: WeeklyReport[] = rows.map((r) => ({
      weeklyReportId: r.weekly_report_id,
      weekStartDt:    r.week_start_dt.toISOString().slice(0, 10),
      draftCn:        r.draft_cn,
      perfCn:         r.perf_cn,
      planCn:         r.plan_cn,
      commentCn:      r.comment_cn,
      noteCn:         r.note_cn,
      aiTaskId:       r.ai_task_id,
      aiTaskStatus:   r.ai_task_id ? statusMap.get(r.ai_task_id) ?? null : null,
      creatMberId:    r.creat_mber_id,
      creatMberNm:    nameMap.get(r.creat_mber_id) ?? null,
      creatDt:        r.creat_dt.toISOString(),
      mdfcnDt:        r.mdfcn_dt ? r.mdfcn_dt.toISOString() : null,
    }));

    return apiSuccess({ items });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/weekly-reports] DB 오류:`, err);
    return apiError("DB_ERROR", "주간보고 이력 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 초안 생성/재생성 요청 ─────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(request, projectId, "weeklyReport.manage");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }
  const { weekStartDt } = body as { weekStartDt?: string };
  if (!isValidDateStr(weekStartDt)) {
    return apiError("VALIDATION_ERROR", "weekStartDt 형식이 올바르지 않습니다 (YYYY-MM-DD).", 400);
  }

  // 월요일이 아닌 날짜가 와도 그 주의 월요일로 정규화 — 페이지에서 실수로 다른 요일을 보내도 안전
  const weekStart = getWeekMondayStr(weekStartDt);
  const weekEnd   = addDaysStr(weekStart, 6);

  try {
    // 데이터 수집 + 프롬프트 조립은 lib로 분리 — GET .../export-md(개인 Claude 요청용 MD 내보내기)와
    // 완전히 같은 로직을 공유해야 "AI에게 실제로 전달되는 내용"이라는 게 거짓말이 안 된다.
    const { finalReqCn, promptTmplId } = await buildWeeklyReportPrompt(projectId, weekStart);

    if (promptTmplId) {
      await prisma.tbAiPromptTemplate.update({
        where: { tmpl_id: promptTmplId },
        data:  { use_cnt: { increment: 1 } },
      });
    }

    // ── 주간보고 upsert + AI 태스크 생성 (한 트랜잭션) ────────────────────────
    const result = await prisma.$transaction(async (tx) => {
      const report = await tx.tbWrWeeklyReport.upsert({
        where: {
          prjct_id_week_start_dt: { prjct_id: projectId, week_start_dt: new Date(weekStart + "T00:00:00Z") },
        },
        update: { mdfr_mber_id: gate.mberId, mdfcn_dt: new Date() },
        create: { prjct_id: projectId, week_start_dt: new Date(weekStart + "T00:00:00Z"), creat_mber_id: gate.mberId },
      });

      const task = await tx.tbAiTask.create({
        data: {
          prjct_id:          projectId,
          ref_ty_code:       "WEEKLY_REPORT",
          ref_id:            report.weekly_report_id,
          task_ty_code:      "WEEKLY_REPORT_DRAFT",
          req_cn:            finalReqCn,
          req_snapshot_data: { weekStart, weekEnd, promptTmplId },
          req_mber_id:       gate.mberId,
          task_sttus_code:   "PENDING",
          retry_cnt:         0,
        },
      });

      await tx.tbWrWeeklyReport.update({
        where: { weekly_report_id: report.weekly_report_id },
        data:  { ai_task_id: task.ai_task_id },
      });

      return { weeklyReportId: report.weekly_report_id, aiTaskId: task.ai_task_id };
    });

    return apiSuccess({ ...result, status: "PENDING" }, 202);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/weekly-reports] DB 오류:`, err);
    return apiError("DB_ERROR", "주간보고 초안 생성 요청에 실패했습니다.", 500);
  }
}
