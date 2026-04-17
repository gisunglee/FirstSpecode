/**
 * GET    /api/projects/[id]/user-stories/[storyId] — 스토리 상세 조회 (FID-00114)
 * PUT    /api/projects/[id]/user-stories/[storyId] — 스토리 수정 (FID-00116 수정)
 * DELETE /api/projects/[id]/user-stories/[storyId] — 스토리 삭제 (FID-00112)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; storyId: string }> };

// ─── GET: 상세 조회 ──────────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, storyId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const story = await prisma.tbRqUserStory.findUnique({
      where:   { story_id: storyId },
      include: {
        requirement: {
          select: {
            req_id:   true,
            req_nm:   true,
            prjct_id: true,
            task_id:  true,
            task:     { select: { task_id: true, task_nm: true } },
          },
        },
        acceptanceCriteria: {
          orderBy: { sort_ordr: "asc" },
        },
      },
    });

    if (!story || story.requirement.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "사용자스토리를 찾을 수 없습니다.", 404);
    }

    return apiSuccess({
      storyId:         story.story_id,
      displayId:       story.story_display_id,
      name:            story.story_nm,
      persona:         story.persona_cn ?? "",
      scenario:        story.scenario_cn ?? "",
      requirementId:   story.req_id,
      requirementName: story.requirement.req_nm,
      taskId:          story.requirement.task_id ?? null,
      taskName:        story.requirement.task?.task_nm ?? "미분류",
      acceptanceCriteria: story.acceptanceCriteria.map((ac) => ({
        acId:    ac.ac_id,
        given:   ac.given_cn ?? "",
        when:    ac.when_cn  ?? "",
        then:    ac.then_cn  ?? "",
      })),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/user-stories/${storyId}] DB 오류:`, err);
    return apiError("DB_ERROR", "사용자스토리 조회에 실패했습니다.", 500);
  }
}

// ─── PUT: 수정 ───────────────────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, storyId } = await params;

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
    requirementId?:      string;
    name?:               string;
    persona?:            string;
    scenario?:           string;
    acceptanceCriteria?: { given?: string; when?: string; then?: string }[];
  };

  if (!requirementId)   return apiError("VALIDATION_ERROR", "요구사항을 선택해 주세요.", 400);
  if (!name?.trim())    return apiError("VALIDATION_ERROR", "스토리명을 입력해 주세요.", 400);
  if (!persona?.trim()) return apiError("VALIDATION_ERROR", "페르소나를 입력해 주세요.", 400);
  if (!scenario?.trim()) return apiError("VALIDATION_ERROR", "시나리오를 입력해 주세요.", 400);

  // 스토리 존재 및 프로젝트 소속 확인
  const existing = await prisma.tbRqUserStory.findUnique({
    where:   { story_id: storyId },
    include: { requirement: { select: { prjct_id: true } } },
  });
  if (!existing || existing.requirement.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "사용자스토리를 찾을 수 없습니다.", 404);
  }

  try {
    await prisma.$transaction(async (tx) => {
      // 스토리 수정
      await tx.tbRqUserStory.update({
        where: { story_id: storyId },
        data:  {
          req_id:      requirementId,
          story_nm:    name.trim(),
          persona_cn:  persona.trim(),
          scenario_cn: scenario.trim(),
          mdfcn_dt:    new Date(),
        },
      });

      // 인수기준: 기존 전체 삭제 후 재생성
      await tx.tbRqAcceptanceCriteria.deleteMany({ where: { story_id: storyId } });

      if (acceptanceCriteria && acceptanceCriteria.length > 0) {
        await tx.tbRqAcceptanceCriteria.createMany({
          data: acceptanceCriteria
            .filter((ac) => ac.given?.trim() || ac.when?.trim() || ac.then?.trim())
            .map((ac, idx) => ({
              story_id:  storyId,
              given_cn:  ac.given?.trim() || null,
              when_cn:   ac.when?.trim()  || null,
              then_cn:   ac.then?.trim()  || null,
              sort_ordr: idx,
            })),
        });
      }
    });

    return apiSuccess({ storyId });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/user-stories/${storyId}] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}

// ─── DELETE: 삭제 ────────────────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, storyId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  try {
    const existing = await prisma.tbRqUserStory.findUnique({
      where:   { story_id: storyId },
      include: { requirement: { select: { prjct_id: true } } },
    });
    if (!existing || existing.requirement.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "사용자스토리를 찾을 수 없습니다.", 404);
    }

    // 인수기준 먼저 삭제 후 스토리 삭제 (수동 cascade)
    await prisma.$transaction([
      prisma.tbRqAcceptanceCriteria.deleteMany({ where: { story_id: storyId } }),
      prisma.tbRqUserStory.delete({ where: { story_id: storyId } }),
    ]);

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/user-stories/${storyId}] DB 오류:`, err);
    return apiError("DB_ERROR", "삭제 중 오류가 발생했습니다.", 500);
  }
}
