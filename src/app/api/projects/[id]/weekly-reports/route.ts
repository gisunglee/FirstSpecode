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
    // ── 그 주 전체 팀원 업무일지 수집 ──────────────────────────────────────
    const logs = await prisma.tbWrWorkLog.findMany({
      where: {
        prjct_id:    projectId,
        log_ty_code: "DAILY",
        log_dt:      { gte: new Date(weekStart + "T00:00:00Z"), lte: new Date(weekEnd + "T00:00:00Z") },
      },
      include: { items: { orderBy: { sort_ordr: "asc" } } },
      orderBy: [{ creat_mber_id: "asc" }, { log_dt: "asc" }],
    });

    const mberIds = [...new Set(logs.map((l) => l.creat_mber_id))];
    const members = mberIds.length > 0
      ? await prisma.tbCmMember.findMany({
          where:  { mber_id: { in: mberIds } },
          select: { mber_id: true, mber_nm: true, email_addr: true },
        })
      : [];
    const nameMap = new Map(members.map((m) => [m.mber_id, m.mber_nm || m.email_addr || m.mber_id]));

    // 멤버별로 묶어 "이름 → 날짜별 완료/미완료/메모" 텍스트로 정리
    const byMember = new Map<string, typeof logs>();
    for (const log of logs) {
      const list = byMember.get(log.creat_mber_id) ?? [];
      list.push(log);
      byMember.set(log.creat_mber_id, list);
    }

    const logLines: string[] = [];
    for (const [mberId, memberLogs] of byMember) {
      logLines.push(`### ${nameMap.get(mberId)}`);
      for (const log of memberLogs) {
        const dateStr = log.log_dt.toISOString().slice(0, 10);
        // ref_ty_code 있는 항목은 "참고 일감 태그"(체크박스 없음, 완료 개념이 없음) — 계획 체크리스트와
        // 별개다. 완료/미완료 집계에 섞으면 AI가 "게시판 일감 미완료"처럼 잘못 요약할 수 있어 제외하고,
        // 대신 "관련 일감"으로 따로 알려준다.
        const todoLogItems = log.items.filter((i) => !i.ref_ty_code);
        const tagLogItems  = log.items.filter((i) => i.ref_ty_code);
        const done    = todoLogItems.filter((i) => i.done_yn === "Y").map((i) => i.item_cn);
        const undone  = todoLogItems.filter((i) => i.done_yn !== "Y").map((i) => i.item_cn);
        const linePart: string[] = [];
        if (done.length)          linePart.push(`완료: ${done.join(", ")}`);
        if (undone.length)        linePart.push(`미완료: ${undone.join(", ")}`);
        if (tagLogItems.length)   linePart.push(`관련 일감: ${tagLogItems.map((i) => i.item_cn).join(", ")}`);
        if (log.note_cn?.trim())  linePart.push(`메모: ${log.note_cn.trim()}`);
        logLines.push(`- ${dateStr}: ${linePart.length ? linePart.join(" / ") : "(기록 없음)"}`);
      }
    }
    const logDataBlock = logLines.length > 0 ? logLines.join("\n") : "(이번 주 작성된 업무일지가 없습니다)";

    // ── 프롬프트 템플릿 조회 (default_yn='Y' 우선, 프로젝트 전용 > 시스템 공통) ─────
    const promptTmpl = await prisma.tbAiPromptTemplate.findFirst({
      where: {
        OR:           [{ prjct_id: projectId }, { prjct_id: null }],
        task_ty_code: "WEEKLY_REPORT_DRAFT",
        use_yn:       "Y",
      },
      orderBy: [
        { default_yn: "desc" },
        { prjct_id:    { sort: "desc", nulls: "last" } },
        { creat_dt:    "desc" },
      ],
    });
    const sysPrompt = promptTmpl?.sys_prompt_cn?.trim() ?? "";

    const parts: string[] = [];
    if (sysPrompt) parts.push(`<시스템프롬프트>\n${sysPrompt}\n</시스템프롬프트>`);
    parts.push(`<대상 주간>\n${weekStart} ~ ${weekEnd}\n</대상 주간>`);
    parts.push(`<업무일지 데이터>\n${logDataBlock}\n</업무일지 데이터>`);
    const finalReqCn = parts.join("\n\n");

    if (promptTmpl) {
      await prisma.tbAiPromptTemplate.update({
        where: { tmpl_id: promptTmpl.tmpl_id },
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
          req_snapshot_data: { weekStart, weekEnd, promptTmplId: promptTmpl?.tmpl_id ?? null },
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
