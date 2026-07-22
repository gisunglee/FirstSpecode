/**
 * GET  /api/projects/[id]/milestones — 마일스톤 목록 조회 (날짜 오름차순)
 * POST /api/projects/[id]/milestones — 마일스톤 생성
 *
 * 설정 > 일정 탭 하위 기능. 단계 범위(TbPjProject.anls_bgng_de 등)와 달리
 * "오픈일/이행일" 같은 단일 시점 이벤트를 이름 붙여 자유롭게 추가하는 용도.
 *
 * 권한:
 *   GET  — "content.read" (OWNER/ADMIN/MEMBER/VIEWER 전 멤버). 팀 전체가 공유하는
 *          일정이라 설정 관리 권한과 무관하게 누구나 조회할 수 있어야 한다.
 *   POST — requireScheduleWrite (schedule.manage: OWNER/ADMIN 역할 또는 PM/PL 직무).
 *          생성은 "본인 소유" 개념이 없어 매트릭스 조건만 적용.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { requireScheduleWrite } from "@/lib/requireScheduleWrite";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { apiTextLimitGuard } from "@/lib/constants/textLimits";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 마일스톤 목록 조회 ──────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    const rows = await prisma.tbPjMilestone.findMany({
      where:   { prjct_id: projectId },
      orderBy: { milestone_de: "asc" },
    });

    return apiSuccess({
      items: rows.map((r) => ({
        milestoneId:   r.milestone_id,
        name:          r.milestone_nm,
        date:          r.milestone_de.toISOString().slice(0, 10),
        content:       r.cn ?? "",
        creatorMberId: r.creat_mber_id,
        createdAt:     r.creat_dt.toISOString(),
        modifiedAt:    r.mdfcn_dt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/milestones] DB 오류:`, err);
    return apiError("DB_ERROR", "마일스톤 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 마일스톤 생성 ─────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requireScheduleWrite(request, projectId);
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
    const milestone = await prisma.tbPjMilestone.create({
      data: {
        prjct_id:      projectId,
        milestone_nm:  trimmedName,
        milestone_de:  new Date(date + "T00:00:00Z"),
        cn:            content?.trim() || null,
        creat_mber_id: gate.mberId,
      },
    });

    return apiSuccess({ milestoneId: milestone.milestone_id }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/milestones] DB 오류:`, err);
    return apiError("DB_ERROR", "마일스톤 생성에 실패했습니다.", 500);
  }
}
