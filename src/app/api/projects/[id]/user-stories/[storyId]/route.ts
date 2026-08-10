/**
 * GET    /api/projects/[id]/user-stories/[storyId] — 스토리 상세 조회 (FID-00114)
 * PUT    /api/projects/[id]/user-stories/[storyId] — 스토리 수정 (FID-00116 수정)
 * DELETE /api/projects/[id]/user-stories/[storyId] — 스토리 삭제 (FID-00112)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import {
  requireSpecContentWrite,
  requireSpecChangedFields,
  getSpecContentCapabilities,
  creatorWindowConflict,
} from "@/lib/specContentWritePolicy";
import { isCreatorWindowConflict, lockAndAssertCreatorWindow } from "@/lib/specContentWriteConcurrency";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { userStoryUpdateSchema } from "@/lib/specContentSchemas";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; storyId: string }> };

// ─── GET: 상세 조회 ──────────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, storyId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    const story = await prisma.tbRqUserStory.findUnique({
      where:   { story_id: storyId },
      include: {
        requirement: {
          select: {
            req_id:        true,
            req_nm:        true,
            prjct_id:      true,
            task_id:       true,
            asign_mber_id: true, // 프론트 권한 판정용 — 본인=담당자면 [삭제] 버튼 노출
            task:          { select: { task_id: true, task_nm: true } },
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
    const permissions = await getSpecContentCapabilities(request, projectId, "USER_STORY", storyId, gate);

    return apiSuccess({
      storyId:         story.story_id,
      displayId:       story.story_display_id,
      name:            story.story_nm,
      persona:         story.persona_cn ?? "",
      scenario:        story.scenario_cn ?? "",
      requirementId:   story.req_id,
      requirementName: story.requirement.req_nm,
      // 연결 요구사항의 담당자 — 프론트 [삭제] 버튼 권한 판정에 사용
      requirementAssigneeId: story.requirement.asign_mber_id ?? null,
      taskId:          story.requirement.task_id ?? null,
      taskName:        story.requirement.task?.task_nm ?? "미분류",
      acceptanceCriteria: story.acceptanceCriteria.map((ac) => ({
        acId:    ac.ac_id,
        given:   ac.given_cn ?? "",
        when:    ac.when_cn  ?? "",
        then:    ac.then_cn  ?? "",
      })),
      permissions,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/user-stories/${storyId}] DB 오류:`, err);
    return apiError("DB_ERROR", "사용자스토리 조회에 실패했습니다.", 500);
  }
}

// ─── PUT: 수정 ───────────────────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, storyId } = await params;

  const gate = await requireSpecContentWrite(request, projectId, "USER_STORY", storyId);
  if (gate instanceof Response) return gate;

  const parsed = await parseJsonBody(request, userStoryUpdateSchema);
  if (parsed instanceof Response) return parsed;
  const { requirementId, name, persona, scenario, acceptanceCriteria } = parsed.data;

  // 스토리 존재 및 프로젝트 소속 확인
  const existing = await prisma.tbRqUserStory.findUnique({
    where:   { story_id: storyId },
    include: { requirement: { select: { prjct_id: true } } },
  });
  if (!existing || existing.requirement.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "사용자스토리를 찾을 수 없습니다.", 404);
  }
  const changedFields = [
    ...(requirementId !== existing.req_id ? ["requirementId"] : []),
    ...(name.trim() !== existing.story_nm ? ["name"] : []),
    ...(persona.trim() !== (existing.persona_cn ?? "") ? ["persona"] : []),
    ...(scenario.trim() !== (existing.scenario_cn ?? "") ? ["scenario"] : []),
    ...(acceptanceCriteria !== undefined ? ["acceptanceCriteria"] : []),
  ];
  const fieldError = requireSpecChangedFields(gate, "USER_STORY", changedFields);
  if (fieldError) return fieldError;

  if (requirementId !== existing.req_id) {
    const targetRequirement = await prisma.tbRqRequirement.findFirst({
      where: { req_id: requirementId, prjct_id: projectId },
      select: { req_id: true },
    });
    if (!targetRequirement) return apiError("NOT_FOUND", "요구사항을 찾을 수 없습니다.", 404);
  }

  try {
    await prisma.$transaction(async (tx) => {
      await lockAndAssertCreatorWindow(tx, "USER_STORY", storyId, gate);
      // 스토리 수정
      await tx.tbRqUserStory.update({
        where: { story_id: storyId },
        data:  {
          req_id:      requirementId,
          story_nm:    name.trim(),
          persona_cn:  persona.trim(),
          scenario_cn: scenario.trim(),
          mdfcn_mber_id: gate.mberId,
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
    if (isCreatorWindowConflict(err)) return creatorWindowConflict();
    console.error(`[PUT /api/projects/${projectId}/user-stories/${storyId}] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}

// ─── DELETE: 삭제 ────────────────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, storyId } = await params;

  const gate = await requireSpecContentWrite(request, projectId, "USER_STORY", storyId, "DELETE");
  if (gate instanceof Response) return gate;

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
