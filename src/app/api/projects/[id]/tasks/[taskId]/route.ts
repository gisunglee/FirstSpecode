/**
 * GET    /api/projects/[id]/tasks/[taskId] — 과업 단건 조회 (FID-00096)
 * PUT    /api/projects/[id]/tasks/[taskId] — 과업 수정 (FID-00097 수정)
 * DELETE /api/projects/[id]/tasks/[taskId] — 과업 삭제 (FID-00095)
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
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { apiTextLimitGuard } from "@/lib/constants/textLimits";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { taskUpdateSchema } from "@/lib/specContentSchemas";

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

    // 담당자 이름 조회 — 없거나 퇴장 멤버면 null
    const assignee = task.asign_mber_id
      ? await prisma.tbCmMember.findUnique({
          where:  { mber_id: task.asign_mber_id },
          // email_addr를 fallback으로 — mber_nm 미설정 계정도 식별 가능
          select: { mber_nm: true, email_addr: true },
        })
      : null;
    const permissions = await getSpecContentCapabilities(request, projectId, "TASK", taskId, gate);

    return apiSuccess({
      taskId:           task.task_id,
      displayId:        task.task_display_id,
      name:             task.task_nm,
      category:         task.ctgry_code,
      definition:       task.defn_cn        ?? null,
      content:          task.dtl_cn         ?? null,
      outputInfo:       task.output_info_cn ?? null,
      rfpPage:          task.rfp_page_no    ?? null,
      assignMemberId:   task.asign_mber_id  ?? null,
      assignMemberName: assignee ? (assignee.mber_nm || assignee.email_addr || null) : null,
      permissions,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/tasks/${taskId}] DB 오류:`, err);
    return apiError("DB_ERROR", "과업 조회에 실패했습니다.", 500);
  }
}

// ─── PUT: 과업 수정 ──────────────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, taskId } = await params;

  const gate = await requireSpecContentWrite(request, projectId, "TASK", taskId);
  if (gate instanceof Response) return gate;

  const parsed = await parseJsonBody(request, taskUpdateSchema);
  if (parsed instanceof Response) return parsed;
  const { name, category, definition, content, outputInfo, rfpPage, displayId, assignMemberId } = parsed.data;

  // 장문 텍스트 한도 검증 — 정책은 src/lib/constants/textLimits.ts
  const limitErr = apiTextLimitGuard([
    ["name",           name],
    ["displayId",      displayId],
    ["taskDefinition", definition],
    ["taskDefinition", content],
    ["taskDefinition", outputInfo],
  ]);
  if (limitErr) return limitErr;

  try {
    const existing = await prisma.tbRqTask.findFirst({
      where: { task_id: taskId, prjct_id: projectId },
    });
    if (!existing) return apiError("NOT_FOUND", "과업을 찾을 수 없습니다.", 404);

    const changedFields = [
      ...(name.trim() !== existing.task_nm ? ["name"] : []),
      ...(category !== existing.ctgry_code ? ["category"] : []),
      ...(definition !== undefined && (definition.trim() || null) !== existing.defn_cn ? ["definition"] : []),
      ...(content !== undefined && (content.trim() || null) !== existing.dtl_cn ? ["content"] : []),
      ...(outputInfo !== undefined && (outputInfo.trim() || null) !== existing.output_info_cn ? ["outputInfo"] : []),
      ...(rfpPage !== undefined && (rfpPage.trim() || null) !== existing.rfp_page_no ? ["rfpPage"] : []),
      ...(assignMemberId !== undefined && (assignMemberId || null) !== existing.asign_mber_id ? ["assignMemberId"] : []),
      ...(displayId !== undefined && displayId.trim() !== existing.task_display_id ? ["displayId"] : []),
    ];
    const fieldError = requireSpecChangedFields(gate, "TASK", changedFields);
    if (fieldError) return fieldError;

    // 담당자 변경 감지 — 값이 실제로 바뀌었을 때만 이력 저장 (no-op 스킵)
    // SettingsHistoryDialog의 itemName과 정확히 일치해야 필터됨
    const CHG_REASON_ASSIGNEE = "담당자";
    const prevAssignee    = existing.asign_mber_id ?? null;
    const nextAssignee    = assignMemberId !== undefined ? (assignMemberId || null) : prevAssignee;
    const assigneeChanged = assignMemberId !== undefined && prevAssignee !== nextAssignee;

    // 이력 저장 시 이름도 함께 기록 → 멤버 탈퇴 후에도 이력 뷰 보존
    let assigneeNames: { before: string | null; after: string | null } = { before: null, after: null };
    if (assigneeChanged) {
      const ids = [prevAssignee, nextAssignee].filter((v): v is string => !!v);
      const members = ids.length > 0
        ? await prisma.tbCmMember.findMany({
            where:  { mber_id: { in: ids } },
            // email_addr를 fallback으로 — mber_nm 미설정 계정도 이력에서 식별 가능
            select: { mber_id: true, mber_nm: true, email_addr: true },
          })
        : [];
      const nameMap = new Map(members.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null]));
      assigneeNames = {
        before: prevAssignee ? (nameMap.get(prevAssignee) ?? null) : null,
        after:  nextAssignee ? (nameMap.get(nextAssignee) ?? null) : null,
      };
    }

    await prisma.$transaction(async (tx) => {
      await lockAndAssertCreatorWindow(tx, "TASK", taskId, gate);
      await tx.tbRqTask.update({
        where: { task_id: taskId },
        data: {
          task_nm:         name.trim(),
          task_display_id: displayId?.trim() || existing.task_display_id,
          ctgry_code:      category,
          defn_cn:         definition !== undefined ? (definition?.trim() || null) : existing.defn_cn,
          dtl_cn:          content !== undefined ? (content?.trim() || null) : existing.dtl_cn,
          output_info_cn:  outputInfo !== undefined ? (outputInfo?.trim() || null) : existing.output_info_cn,
          rfp_page_no:     rfpPage !== undefined ? (rfpPage?.trim() || null) : existing.rfp_page_no,
          asign_mber_id:   nextAssignee,
          mdfcn_mber_id:   gate.mberId,
          mdfcn_dt:        new Date(),
        },
      });

      if (assigneeChanged) {
        await tx.tbDsDesignChange.create({
          data: {
            prjct_id:      projectId,
            ref_tbl_nm:    "tb_rq_task",
            ref_id:        taskId,
            chg_type_code: "UPDATE",
            chg_rsn_cn:    CHG_REASON_ASSIGNEE,
            snapshot_data: {
              before:     prevAssignee,
              after:      nextAssignee,
              beforeName: assigneeNames.before,
              afterName:  assigneeNames.after,
            },
            chg_mber_id: gate.mberId,
          },
        });
      }
    });

    return apiSuccess({ ok: true });
  } catch (err) {
    if (isCreatorWindowConflict(err)) return creatorWindowConflict();
    console.error(`[PUT /api/projects/${projectId}/tasks/${taskId}] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}

// ─── DELETE: 과업 삭제 ───────────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, taskId } = await params;

  const gate = await requireSpecContentWrite(request, projectId, "TASK", taskId, "DELETE");
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
