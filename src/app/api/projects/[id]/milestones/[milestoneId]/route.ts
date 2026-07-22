/**
 * PUT    /api/projects/[id]/milestones/[milestoneId] — 마일스톤 수정
 * DELETE /api/projects/[id]/milestones/[milestoneId] — 마일스톤 삭제
 *
 * 권한: requireScheduleWrite — schedule.manage(OWNER/ADMIN 역할 또는 PM/PL 직무)
 * 통과 못 해도 본인이 등록한 마일스톤이면 허용(요구사항 담당자 예외와 동일 관례).
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireScheduleWrite } from "@/lib/requireScheduleWrite";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { apiTextLimitGuard } from "@/lib/constants/textLimits";

type RouteParams = { params: Promise<{ id: string; milestoneId: string }> };

async function getCreatorMberId(milestoneId: string, projectId: string): Promise<string | null> {
  const existing = await prisma.tbPjMilestone.findFirst({
    where:  { milestone_id: milestoneId, prjct_id: projectId },
    select: { creat_mber_id: true },
  });
  return existing?.creat_mber_id ?? null;
}

// ─── PUT: 마일스톤 수정 ──────────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, milestoneId } = await params;
  const gate = await requireScheduleWrite(request, projectId, () => getCreatorMberId(milestoneId, projectId));
  if (gate instanceof Response) return gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { name, date, content } = body as { name?: string; date?: string; content?: string };

  const trimmedName = name?.trim() ?? "";
  if (!trimmedName) {
    return apiError("VALIDATION_ERROR", "마일스톤 이름을 입력해 주세요.", 400);
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return apiError("VALIDATION_ERROR", "날짜 형식이 올바르지 않습니다 (YYYY-MM-DD).", 400);
  }

  const limitErr = apiTextLimitGuard([
    ["milestoneName", trimmedName],
    ["milestoneContent", content],
  ]);
  if (limitErr) return limitErr;

  try {
    const existing = await prisma.tbPjMilestone.findFirst({
      where:  { milestone_id: milestoneId, prjct_id: projectId },
      select: { milestone_id: true },
    });
    if (!existing) return apiError("NOT_FOUND", "마일스톤을 찾을 수 없습니다.", 404);

    await prisma.tbPjMilestone.update({
      where: { milestone_id: milestoneId },
      data: {
        milestone_nm: trimmedName,
        milestone_de: new Date(date + "T00:00:00Z"),
        cn:           content?.trim() || null,
        mdfr_mber_id: gate.mberId,
        mdfcn_dt:     new Date(),
      },
    });

    return apiSuccess({ milestoneId });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/milestones/${milestoneId}] DB 오류:`, err);
    return apiError("DB_ERROR", "마일스톤 수정에 실패했습니다.", 500);
  }
}

// ─── DELETE: 마일스톤 삭제 ───────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, milestoneId } = await params;
  const gate = await requireScheduleWrite(request, projectId, () => getCreatorMberId(milestoneId, projectId));
  if (gate instanceof Response) return gate;

  try {
    const existing = await prisma.tbPjMilestone.findFirst({
      where:  { milestone_id: milestoneId, prjct_id: projectId },
      select: { milestone_id: true },
    });
    if (!existing) return apiError("NOT_FOUND", "마일스톤을 찾을 수 없습니다.", 404);

    await prisma.tbPjMilestone.delete({ where: { milestone_id: milestoneId } });

    return apiSuccess({ milestoneId, deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/milestones/${milestoneId}] DB 오류:`, err);
    return apiError("DB_ERROR", "마일스톤 삭제에 실패했습니다.", 500);
  }
}
