/**
 * GET  /api/projects/[id]/issues — 협조 및 이슈사항 목록 (sort_ordr asc)
 * POST /api/projects/[id]/issues — 이슈 추가
 *
 * 권한: weeklyReport.manage — 리더 리포트의 다른 기능과 동일하게 PM 전용.
 * 주 단위 스냅샷이 아니라 프로젝트가 계속 관리하는 살아있는 목록이라 weekStartDt 파라미터가 없다.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { apiTextLimitGuard } from "@/lib/constants/textLimits";
import type { Issue, IssueCategoryCode, IssueStatusCode } from "@/types/issue";

type RouteParams = { params: Promise<{ id: string }> };

const STATUS_CODES: readonly IssueStatusCode[] = ["OPEN", "IN_PROGRESS", "PARTIAL", "DONE"];
const CATEGORY_CODES: readonly IssueCategoryCode[] = ["CUSTOMER_REQ", "OUR_REQ", "ISSUE"];

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(request, projectId, "weeklyReport.manage");
  if (gate instanceof Response) return gate;

  try {
    const rows = await prisma.tbWrIssue.findMany({
      where:   { prjct_id: projectId },
      orderBy: { sort_ordr: "asc" },
    });

    const items: Issue[] = rows.map((r) => ({
      issueId:      r.issue_id,
      categoryCode: r.category_code as IssueCategoryCode,
      cn:           r.cn,
      actionCn:     r.action_cn,
      requesterNm:  r.requester_nm,
      assigneeNm:   r.assignee_nm,
      reqDt:        r.req_dt ? r.req_dt.toISOString().slice(0, 10) : null,
      dueDt:        r.due_dt ? r.due_dt.toISOString().slice(0, 10) : null,
      statusCode:   r.status_code as IssueStatusCode,
      rptYn:        r.rpt_yn as "Y" | "N",
      sortOrdr:     r.sort_ordr,
    }));

    return apiSuccess({ items });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/issues] DB 오류:`, err);
    return apiError("DB_ERROR", "이슈 목록 조회에 실패했습니다.", 500);
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(request, projectId, "weeklyReport.manage");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }
  const { categoryCode, cn, actionCn, requesterNm, assigneeNm, reqDt, dueDt, statusCode, rptYn } = body as {
    categoryCode?: string; cn?: string; actionCn?: string; requesterNm?: string; assigneeNm?: string;
    reqDt?: string; dueDt?: string; statusCode?: string; rptYn?: string;
  };

  if (statusCode !== undefined && !STATUS_CODES.includes(statusCode as IssueStatusCode)) {
    return apiError("VALIDATION_ERROR", "statusCode는 OPEN/IN_PROGRESS/PARTIAL/DONE 중 하나여야 합니다.", 400);
  }
  if (categoryCode !== undefined && !CATEGORY_CODES.includes(categoryCode as IssueCategoryCode)) {
    return apiError("VALIDATION_ERROR", "categoryCode는 CUSTOMER_REQ/OUR_REQ/ISSUE 중 하나여야 합니다.", 400);
  }
  if (rptYn !== undefined && rptYn !== "Y" && rptYn !== "N") {
    return apiError("VALIDATION_ERROR", "rptYn은 Y 또는 N이어야 합니다.", 400);
  }

  const limitErr = apiTextLimitGuard([
    ["comment", cn],
    ["comment", actionCn],
    ["name", requesterNm],
    ["name", assigneeNm],
  ]);
  if (limitErr) return limitErr;

  try {
    const maxSort = await prisma.tbWrIssue.findFirst({
      where:   { prjct_id: projectId },
      orderBy: { sort_ordr: "desc" },
      select:  { sort_ordr: true },
    });

    const row = await prisma.tbWrIssue.create({
      data: {
        prjct_id:      projectId,
        category_code: categoryCode ?? "ISSUE",
        cn:            cn?.trim() || "",
        action_cn:     actionCn?.trim() || null,
        requester_nm:  requesterNm?.trim() || null,
        assignee_nm:   assigneeNm?.trim() || null,
        req_dt:        reqDt ? new Date(reqDt + "T00:00:00Z") : null,
        due_dt:        dueDt ? new Date(dueDt + "T00:00:00Z") : null,
        status_code:   statusCode ?? "OPEN",
        rpt_yn:        rptYn ?? "Y",
        sort_ordr:      (maxSort?.sort_ordr ?? 0) + 1,
        creat_mber_id: gate.mberId,
      },
    });

    return apiSuccess({ issueId: row.issue_id }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/issues] DB 오류:`, err);
    return apiError("DB_ERROR", "이슈 추가에 실패했습니다.", 500);
  }
}
