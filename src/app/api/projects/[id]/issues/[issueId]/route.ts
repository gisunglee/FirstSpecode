/**
 * PATCH  /api/projects/[id]/issues/[issueId] — 이슈 필드 수정
 * DELETE /api/projects/[id]/issues/[issueId] — 이슈 삭제
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { apiTextLimitGuard } from "@/lib/constants/textLimits";
import type { IssueCategoryCode, IssueStatusCode } from "@/types/issue";

type RouteParams = { params: Promise<{ id: string; issueId: string }> };

const STATUS_CODES: readonly IssueStatusCode[] = ["OPEN", "IN_PROGRESS", "PARTIAL", "DONE"];
const CATEGORY_CODES: readonly IssueCategoryCode[] = ["CUSTOMER_REQ", "OUR_REQ", "ISSUE"];

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, issueId } = await params;
  const gate = await requirePermission(request, projectId, "weeklyReport.manage");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }
  const { categoryCode, cn, actionCn, requesterNm, assigneeNm, reqDt, dueDt, statusCode, rptYn } = body as {
    categoryCode?: string; cn?: string; actionCn?: string; requesterNm?: string; assigneeNm?: string;
    reqDt?: string | null; dueDt?: string | null; statusCode?: string; rptYn?: string;
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
    const existing = await prisma.tbWrIssue.findFirst({
      where:  { issue_id: issueId, prjct_id: projectId },
      select: { issue_id: true },
    });
    if (!existing) return apiError("NOT_FOUND", "이슈를 찾을 수 없습니다.", 404);

    await prisma.tbWrIssue.update({
      where: { issue_id: issueId },
      data: {
        ...(categoryCode !== undefined ? { category_code: categoryCode } : {}),
        ...(cn !== undefined ? { cn: cn.trim() } : {}),
        ...(actionCn !== undefined ? { action_cn: actionCn.trim() || null } : {}),
        ...(requesterNm !== undefined ? { requester_nm: requesterNm.trim() || null } : {}),
        ...(assigneeNm !== undefined ? { assignee_nm: assigneeNm.trim() || null } : {}),
        ...(reqDt !== undefined ? { req_dt: reqDt ? new Date(reqDt + "T00:00:00Z") : null } : {}),
        ...(dueDt !== undefined ? { due_dt: dueDt ? new Date(dueDt + "T00:00:00Z") : null } : {}),
        ...(statusCode !== undefined ? { status_code: statusCode } : {}),
        ...(rptYn !== undefined ? { rpt_yn: rptYn } : {}),
        mdfr_mber_id: gate.mberId,
        mdfcn_dt: new Date(),
      },
    });

    return apiSuccess({ issueId });
  } catch (err) {
    console.error(`[PATCH /api/projects/${projectId}/issues/${issueId}] DB 오류:`, err);
    return apiError("DB_ERROR", "이슈 수정에 실패했습니다.", 500);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, issueId } = await params;
  const gate = await requirePermission(request, projectId, "weeklyReport.manage");
  if (gate instanceof Response) return gate;

  try {
    const existing = await prisma.tbWrIssue.findFirst({
      where:  { issue_id: issueId, prjct_id: projectId },
      select: { issue_id: true },
    });
    if (!existing) return apiError("NOT_FOUND", "이슈를 찾을 수 없습니다.", 404);

    await prisma.tbWrIssue.delete({ where: { issue_id: issueId } });

    return apiSuccess({ issueId });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/issues/${issueId}] DB 오류:`, err);
    return apiError("DB_ERROR", "이슈 삭제에 실패했습니다.", 500);
  }
}
