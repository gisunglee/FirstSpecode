/**
 * GET /api/projects/[id]/work-logs — 업무일지 조회 (단일 날짜 또는 기간)
 * PUT  /api/projects/[id]/work-logs — 업무일지 upsert (본인 것만, 하루/한 주 단위)
 *
 * 쿼리(GET):
 *   date=YYYY-MM-DD        — 단일 날짜 조회 ("오늘의 할일" 탭)
 *   from=&to=YYYY-MM-DD    — 기간 조회 ("기록 보기" 탭)
 *   logTyCode=DAILY|WEEK   — 기본 DAILY
 *   mberId=me|all          — 기본 me. all = 팀 전체(주간보고 집계·팀 조회용, content.read 있으면 누구나)
 */

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { apiTextLimitGuard } from "@/lib/constants/textLimits";
import type { WorkLog, WorkLogTypeCode, WorkLogItemRefType } from "@/types/workLog";

type RouteParams = { params: Promise<{ id: string }> };

const LOG_TYPES: readonly WorkLogTypeCode[] = ["DAILY", "WEEK"];

function isValidDateStr(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// ─── GET: 업무일지 조회 ──────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const url         = new URL(request.url);
  const dateParam    = url.searchParams.get("date");
  const fromParam    = url.searchParams.get("from");
  const toParam      = url.searchParams.get("to");
  const logTyParam   = url.searchParams.get("logTyCode");
  const mberIdParam  = url.searchParams.get("mberId") ?? "me";

  const logTyCode: WorkLogTypeCode = LOG_TYPES.includes(logTyParam as WorkLogTypeCode)
    ? (logTyParam as WorkLogTypeCode)
    : "DAILY";

  if (dateParam && !isValidDateStr(dateParam)) {
    return apiError("VALIDATION_ERROR", "date 형식이 올바르지 않습니다 (YYYY-MM-DD).", 400);
  }
  if ((fromParam && !isValidDateStr(fromParam)) || (toParam && !isValidDateStr(toParam))) {
    return apiError("VALIDATION_ERROR", "from/to 형식이 올바르지 않습니다 (YYYY-MM-DD).", 400);
  }
  if (!dateParam && !(fromParam && toParam)) {
    return apiError("VALIDATION_ERROR", "date 또는 from+to 파라미터가 필요합니다.", 400);
  }

  try {
    const where: Prisma.TbWrWorkLogWhereInput = {
      prjct_id:      projectId,
      log_ty_code:   logTyCode,
      creat_mber_id: mberIdParam === "all" ? undefined : mberIdParam === "me" ? gate.mberId : mberIdParam,
      log_dt:        dateParam
        ? new Date(dateParam + "T00:00:00Z")
        : { gte: new Date(fromParam + "T00:00:00Z"), lte: new Date(toParam + "T00:00:00Z") },
    };

    const rows = await prisma.tbWrWorkLog.findMany({
      where,
      include: { items: { orderBy: { sort_ordr: "asc" } } },
      orderBy: [{ log_dt: "desc" }, { creat_mber_id: "asc" }],
    });

    // 작성자 이름 일괄 조회 (N+1 방지) — pm-summary와 동일 패턴
    const mberIds = [...new Set(rows.map((r) => r.creat_mber_id))];
    const members = mberIds.length > 0
      ? await prisma.tbCmMember.findMany({
          where:  { mber_id: { in: mberIds } },
          select: { mber_id: true, mber_nm: true, email_addr: true },
        })
      : [];
    const nameMap = new Map(members.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null]));

    const items: WorkLog[] = rows.map((r) => ({
      workLogId: r.work_log_id,
      mberId:    r.creat_mber_id,
      mberNm:    nameMap.get(r.creat_mber_id) ?? null,
      logTyCode: r.log_ty_code as WorkLogTypeCode,
      logDt:     r.log_dt.toISOString().slice(0, 10),
      noteCn:    r.note_cn,
      resultCn:  r.result_cn,
      items: r.items.map((it) => ({
        itemId:    it.item_id,
        itemCn:    it.item_cn,
        refTyCode: (it.ref_ty_code as WorkLogItemRefType | null) ?? null,
        refId:     it.ref_id,
        doneYn:    it.done_yn as "Y" | "N",
        sortOrdr:  it.sort_ordr,
      })),
      creatDt: r.creat_dt.toISOString(),
      mdfcnDt: r.mdfcn_dt ? r.mdfcn_dt.toISOString() : null,
    }));

    return apiSuccess({ items });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/work-logs] DB 오류:`, err);
    return apiError("DB_ERROR", "업무일지 조회에 실패했습니다.", 500);
  }
}

// ─── PUT: 업무일지 upsert (본인 것만) ────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  // resultCn — WEEK 타입 전용("이번주 결과"). DAILY는 안 보내면 그냥 null 유지.
  const { logTyCode, logDt, noteCn, resultCn } = body as {
    logTyCode?: string; logDt?: string; noteCn?: string; resultCn?: string;
  };

  if (!logTyCode || !LOG_TYPES.includes(logTyCode as WorkLogTypeCode)) {
    return apiError("VALIDATION_ERROR", "logTyCode는 DAILY 또는 WEEK여야 합니다.", 400);
  }
  if (!isValidDateStr(logDt ?? null)) {
    return apiError("VALIDATION_ERROR", "logDt 형식이 올바르지 않습니다 (YYYY-MM-DD).", 400);
  }

  const limitErr = apiTextLimitGuard([["comment", noteCn], ["comment", resultCn]]);
  if (limitErr) return limitErr;

  try {
    const logDtValue = new Date(logDt + "T00:00:00Z");

    // 작성자(gate.mberId) 고정 — body 로 mberId 를 받지 않음: 본인 일지만 upsert 가능
    const row = await prisma.tbWrWorkLog.upsert({
      where: {
        prjct_id_creat_mber_id_log_ty_code_log_dt: {
          prjct_id:      projectId,
          creat_mber_id: gate.mberId,
          log_ty_code:   logTyCode,
          log_dt:        logDtValue,
        },
      },
      update: {
        note_cn:      noteCn?.trim() || null,
        result_cn:    resultCn?.trim() || null,
        mdfr_mber_id: gate.mberId,
        mdfcn_dt:     new Date(),
      },
      create: {
        prjct_id:      projectId,
        creat_mber_id: gate.mberId,
        log_ty_code:   logTyCode,
        log_dt:        logDtValue,
        note_cn:       noteCn?.trim() || null,
        result_cn:     resultCn?.trim() || null,
      },
    });

    return apiSuccess({ workLogId: row.work_log_id });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/work-logs] DB 오류:`, err);
    return apiError("DB_ERROR", "업무일지 저장에 실패했습니다.", 500);
  }
}
