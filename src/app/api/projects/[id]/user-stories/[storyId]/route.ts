/**
 * GET    /api/projects/[id]/user-stories/[storyId] — 스토리 상세 조회 (FID-00114)
 * PUT    /api/projects/[id]/user-stories/[storyId] — 스토리 수정 (FID-00116 수정)
 * DELETE /api/projects/[id]/user-stories/[storyId] — 스토리 삭제 (FID-00112)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { requireAuth } from "@/lib/requireAuth";
import {
  hasPermission, isRoleCode, isJobCode,
  type RoleCode, type JobCode,
} from "@/lib/permissions";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; storyId: string }> };

/**
 * 사용자스토리 삭제 권한 게이트.
 *
 * 통과 조건 (OR):
 *   ① permissions 매트릭스 "requirement.update" 통과 — OWNER/ADMIN 역할 또는 PM/PL 직무
 *   ② 본인이 "이 스토리와 연결된 요구사항"의 담당자(asign_mber_id)
 *
 * (사용자스토리 자체에는 작성자/담당자 컬럼이 없으므로 연결 요구사항의 담당자를 기준으로 함.)
 */
async function requireStoryDelete(
  request: NextRequest,
  projectId: string,
  storyId: string
): Promise<{ mberId: string } | Response> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where:  { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
    select: { role_code: true, job_title_code: true, mber_sttus_code: true },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "프로젝트 멤버가 아닙니다.", 403);
  }

  const role: RoleCode | null = isRoleCode(membership.role_code) ? membership.role_code : null;
  const job:  JobCode  | null = isJobCode(membership.job_title_code) ? membership.job_title_code : null;

  // ① 매트릭스: OWNER/ADMIN 역할 또는 PM/PL 직무
  const matrixOK = hasPermission(
    { role, job, plan: "FREE", systemRole: null },
    "requirement.update"
  );
  if (matrixOK) return { mberId: auth.mberId };

  // ② 연결된 요구사항의 담당자인지 확인
  const story = await prisma.tbRqUserStory.findUnique({
    where:   { story_id: storyId },
    include: { requirement: { select: { prjct_id: true, asign_mber_id: true } } },
  });
  if (!story || story.requirement.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "사용자스토리를 찾을 수 없습니다.", 404);
  }
  if (story.requirement.asign_mber_id !== auth.mberId) {
    return apiError("FORBIDDEN", "이 사용자스토리를 삭제할 권한이 없습니다.", 403);
  }

  return { mberId: auth.mberId };
}

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
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/user-stories/${storyId}] DB 오류:`, err);
    return apiError("DB_ERROR", "사용자스토리 조회에 실패했습니다.", 500);
  }
}

// ─── PUT: 수정 ───────────────────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, storyId } = await params;

  const gate = await requirePermission(request, projectId, "content.update");
  if (gate instanceof Response) return gate;

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
  const { id: projectId, storyId } = await params;

  // OWNER/ADMIN 역할 OR PM/PL 직무 OR 연결 요구사항의 담당자만 삭제 가능
  const gate = await requireStoryDelete(request, projectId, storyId);
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
