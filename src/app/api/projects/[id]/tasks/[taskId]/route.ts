/**
 * GET    /api/projects/[id]/tasks/[taskId] — 과업 단건 조회 (FID-00096)
 * PUT    /api/projects/[id]/tasks/[taskId] — 과업 수정 (FID-00097 수정)
 * DELETE /api/projects/[id]/tasks/[taskId] — 과업 삭제 (FID-00095)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; taskId: string }> };

// ─── GET: 과업 단건 조회 ─────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, taskId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

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
  const { id: projectId, taskId } = await params;

  const gate = await requirePermission(request, projectId, "content.update");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { name, category, definition, content, outputInfo, rfpPage, displayId } = body as {
    name?: string; category?: string;
    definition?: string; content?: string;
    outputInfo?: string; rfpPage?: string;
    displayId?: string;
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
        task_nm:         name.trim(),
        task_display_id: displayId?.trim() || existing.task_display_id,
        ctgry_code:      category,
        defn_cn:         definition !== undefined ? (definition?.trim() || null) : existing.defn_cn,
        dtl_cn:          content !== undefined ? (content?.trim() || null) : existing.dtl_cn,
        output_info_cn:  outputInfo !== undefined ? (outputInfo?.trim() || null) : existing.output_info_cn,
        rfp_page_no:     rfpPage !== undefined ? (rfpPage?.trim() || null) : existing.rfp_page_no,
        mdfcn_dt:        new Date(),
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
  const { id: projectId, taskId } = await params;

  const gate = await requirePermission(request, projectId, "content.delete");
  if (gate instanceof Response) return gate;

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
