/**
 * GET  /api/projects/[id]/user-stories — 사용자스토리 목록 조회 (FID-00110, FID-00111)
 * POST /api/projects/[id]/user-stories — 사용자스토리 생성 (FID-00116 신규)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 목록 조회 ──────────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  const url          = new URL(request.url);
  const taskId       = url.searchParams.get("taskId")       || undefined;
  const requirementId = url.searchParams.get("requirementId") || undefined;
  const keyword      = url.searchParams.get("keyword")      || undefined;

  try {
    // 요구사항 필터: taskId가 있으면 해당 과업의 요구사항만, 없으면 프로젝트 전체
    // requirementId가 명시되면 해당 요구사항만
    let reqIds: string[] | undefined;

    if (requirementId) {
      reqIds = [requirementId];
    } else if (taskId) {
      const reqs = await prisma.tbRqRequirement.findMany({
        where:  { prjct_id: projectId, task_id: taskId },
        select: { req_id: true },
      });
      reqIds = reqs.map((r) => r.req_id);
    }

    const stories = await prisma.tbRqUserStory.findMany({
      where: {
        requirement: { prjct_id: projectId },
        // reqIds가 정의된 경우에만 IN 필터 적용
        ...(reqIds !== undefined ? { req_id: { in: reqIds } } : {}),
        // 키워드: 스토리명 또는 페르소나 부분 일치
        ...(keyword
          ? {
              OR: [
                { story_nm:   { contains: keyword, mode: "insensitive" } },
                { persona_cn: { contains: keyword, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        requirement: {
          select: {
            req_id:  true,
            req_nm:  true,
            task_id: true,
            task:    { select: { task_id: true, task_nm: true } },
          },
        },
        acceptanceCriteria: { select: { ac_id: true } },
      },
      orderBy: [
        { requirement: { sort_ordr: "asc" } },
        { sort_ordr: "asc" },
        { creat_dt:  "desc" },
      ],
    });

    const items = stories.map((s) => ({
      storyId:             s.story_id,
      displayId:           s.story_display_id,
      name:                s.story_nm,
      persona:             s.persona_cn ?? "",
      requirementId:       s.req_id,
      requirementName:     s.requirement.req_nm,
      taskId:              s.requirement.task_id ?? null,
      taskName:            s.requirement.task?.task_nm ?? "미분류",
      acceptanceCriteriaCount: s.acceptanceCriteria.length,
    }));

    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/user-stories] DB 오류:`, err);
    return apiError("DB_ERROR", "사용자스토리 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 생성 ──────────────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { requirementId, name, persona, scenario, acceptanceCriteria } = body as {
    requirementId?:       string;
    name?:                string;
    persona?:             string;
    scenario?:            string;
    acceptanceCriteria?:  { given?: string; when?: string; then?: string }[];
  };

  if (!requirementId) return apiError("VALIDATION_ERROR", "요구사항을 선택해 주세요.", 400);
  if (!name?.trim())   return apiError("VALIDATION_ERROR", "스토리명을 입력해 주세요.", 400);
  if (!persona?.trim())  return apiError("VALIDATION_ERROR", "페르소나를 입력해 주세요.", 400);
  if (!scenario?.trim()) return apiError("VALIDATION_ERROR", "시나리오를 입력해 주세요.", 400);

  // 요구사항이 이 프로젝트에 속하는지 확인
  const req = await prisma.tbRqRequirement.findUnique({ where: { req_id: requirementId } });
  if (!req || req.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "요구사항을 찾을 수 없습니다.", 404);
  }

  try {
    // 표시 ID 채번 (STR-NNNNN) — 프로젝트 내 최대값 + 1
    const maxStory = await prisma.tbRqUserStory.findFirst({
      where:   { requirement: { prjct_id: projectId } },
      orderBy: { story_display_id: "desc" },
      select:  { story_display_id: true },
    });
    const nextSeq  = maxStory
      ? (parseInt(maxStory.story_display_id.replace(/\D/g, "")) || 0) + 1
      : 1;
    const displayId = `STR-${String(nextSeq).padStart(5, "0")}`;

    // sort_ordr: 해당 요구사항의 마지막 + 1
    const maxSort = await prisma.tbRqUserStory.findFirst({
      where:   { req_id: requirementId },
      orderBy: { sort_ordr: "desc" },
      select:  { sort_ordr: true },
    });

    const story = await prisma.$transaction(async (tx) => {
      const created = await tx.tbRqUserStory.create({
        data: {
          req_id:           requirementId,
          story_display_id: displayId,
          story_nm:         name.trim(),
          persona_cn:       persona.trim(),
          scenario_cn:      scenario.trim(),
          sort_ordr:        (maxSort?.sort_ordr ?? 0) + 1,
        },
      });

      // 인수기준 일괄 생성
      if (acceptanceCriteria && acceptanceCriteria.length > 0) {
        await tx.tbRqAcceptanceCriteria.createMany({
          data: acceptanceCriteria
            .filter((ac) => ac.given?.trim() || ac.when?.trim() || ac.then?.trim())
            .map((ac, idx) => ({
              story_id:  created.story_id,
              given_cn:  ac.given?.trim() || null,
              when_cn:   ac.when?.trim()  || null,
              then_cn:   ac.then?.trim()  || null,
              sort_ordr: idx,
            })),
        });
      }

      return created;
    });

    return apiSuccess({ storyId: story.story_id, displayId: story.story_display_id }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/user-stories] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}
