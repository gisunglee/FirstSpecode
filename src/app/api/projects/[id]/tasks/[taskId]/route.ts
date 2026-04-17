/**
 * GET    /api/projects/[id]/tasks/[taskId] — 과업 단건 조회 (FID-00096)
 * PUT    /api/projects/[id]/tasks/[taskId] — 과업 수정 (FID-00097 수정)
 * DELETE /api/projects/[id]/tasks/[taskId] — 과업 삭제 (FID-00095)
 */


import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; taskId: string }> };

// ─── GET: 과업 단건 조회 ─────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, taskId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const task = await prisma.tbRqTask.findFirst({
      where: { task_id: taskId, prjct_id: projectId },
    });
    if (!task) return apiError("NOT_FOUND", "과업을 찾을 수 없습니다.", 404);

    return apiSuccess({
      taskId:     task.task_id,
      displayId:  task.task_display_id,
      name:       task.task_nm,
      category:   task.ctgry_code,
      definition: task.defn_cn    ?? null,
      content:    task.dtl_cn     ?? null,
      outputInfo: task.output_info_cn ?? null,
      rfpPage:    task.rfp_page_no ?? null,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/tasks/${taskId}] DB 오류:`, err);
    return apiError("DB_ERROR", "과업 조회에 실패했습니다.", 500);
  }
}

// ─── PUT: 과업 수정 ──────────────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, taskId } = await params;

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

  const { name, category, definition, content, outputInfo, rfpPage } = body as {
    name?: string; category?: string;
    definition?: string; content?: string;
    outputInfo?: string; rfpPage?: string;
  };

  if (!name?.trim()) return apiError("VALIDATION_ERROR", "과업명을 입력해 주세요.", 400);
  if (!category?.trim()) return apiError("VALIDATION_ERROR", "카테고리를 선택해 주세요.", 400);

  try {
    const existing = await prisma.tbRqTask.findFirst({
      where: { task_id: taskId, prjct_id: projectId },
    });
    if (!existing) return apiError("NOT_FOUND", "과업을 찾을 수 없습니다.", 404);

    await prisma.tbRqTask.update({
      where: { task_id: taskId },
      data: {
        task_nm:        name.trim(),
        ctgry_code:     category,
        defn_cn:        definition?.trim() || null,
        dtl_cn:         content?.trim() || null,
        output_info_cn: outputInfo?.trim() || null,
        rfp_page_no:    rfpPage?.trim() || null,
        mdfcn_dt:       new Date(),
      },
    });

    return apiSuccess({ ok: true });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/tasks/${taskId}] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}

// ─── DELETE: 과업 삭제 ───────────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, taskId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  // deleteType: 'ALL' | 'TASK_ONLY'
  const url        = new URL(request.url);
  const deleteType = url.searchParams.get("deleteType") ?? "ALL";

  try {
    const existing = await prisma.tbRqTask.findFirst({
      where: { task_id: taskId, prjct_id: projectId },
    });
    if (!existing) return apiError("NOT_FOUND", "과업을 찾을 수 없습니다.", 404);

    if (deleteType === "TASK_ONLY") {
      // 하위 요구사항 task_id를 NULL로 → 미분류 상태 유지
      await prisma.$transaction(async (tx) => {
        await tx.tbRqRequirement.updateMany({
          where: { task_id: taskId },
          data:  { task_id: null },
        });
        await tx.tbRqTask.delete({ where: { task_id: taskId } });
      });
    } else {
      // ALL: CASCADE 삭제 (Prisma는 cascade 미지원 — 수동 순서 삭제)
      await prisma.$transaction(async (tx) => {
        // acceptance_criteria → user_story → requirement → task 순서
        const reqIds = (
          await tx.tbRqRequirement.findMany({
            where: { task_id: taskId },
            select: { req_id: true },
          })
        ).map((r) => r.req_id);

        if (reqIds.length > 0) {
          const storyIds = (
            await tx.tbRqUserStory.findMany({
              where: { req_id: { in: reqIds } },
              select: { story_id: true },
            })
          ).map((s) => s.story_id);

          if (storyIds.length > 0) {
            await tx.tbRqAcceptanceCriteria.deleteMany({
              where: { story_id: { in: storyIds } },
            });
          }
          await tx.tbRqUserStory.deleteMany({ where: { req_id: { in: reqIds } } });
          await tx.tbRqRequirement.deleteMany({ where: { task_id: taskId } });
        }

        await tx.tbRqTask.delete({ where: { task_id: taskId } });
      });
    }

    return apiSuccess({ ok: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/tasks/${taskId}] DB 오류:`, err);
    return apiError("DB_ERROR", "삭제 중 오류가 발생했습니다.", 500);
  }
}
