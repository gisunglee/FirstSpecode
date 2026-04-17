/**
 * POST /api/projects/[id]/tasks/[taskId]/copy — 과업 복사 (FID-00094)
 *
 * 역할:
 *   - 과업 + 하위 요구사항 + 스토리 + 인수기준 전체 복사
 *   - task_display_id, req_display_id, story_display_id 자동 채번
 *   - 복사된 과업명: '[복사] 원본과업명'
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; taskId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
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

  try {
    // 원본 과업 조회
    const original = await prisma.tbRqTask.findFirst({
      where: { task_id: taskId, prjct_id: projectId },
      include: {
        requirements: {
          include: { userStories: { include: { acceptanceCriteria: true } } },
        },
      },
    });
    if (!original) return apiError("NOT_FOUND", "과업을 찾을 수 없습니다.", 404);

    // 채번 베이스값 조회
    const [maxTask, maxReq, maxSort] = await Promise.all([
      prisma.tbRqTask.findFirst({
        where: { prjct_id: projectId },
        orderBy: { task_display_id: "desc" },
        select: { task_display_id: true },
      }),
      prisma.tbRqRequirement.findFirst({
        where: { prjct_id: projectId },
        orderBy: { req_display_id: "desc" },
        select: { req_display_id: true },
      }),
      prisma.tbRqTask.findFirst({
        where: { prjct_id: projectId },
        orderBy: { sort_ordr: "desc" },
        select: { sort_ordr: true },
      }),
    ]);

    let taskSeq  = maxTask  ? (parseInt(maxTask.task_display_id.replace(/\D/g, "")) || 0) + 1 : 1;
    let reqSeq   = maxReq   ? (parseInt(maxReq.req_display_id.replace(/\D/g, "")) || 0) + 1 : 1;
    const sortOrder = (maxSort?.sort_ordr ?? 0) + 1;

    const newTaskId = `${crypto.randomUUID()}`;
    const newDisplayId = `SFR-${String(taskSeq).padStart(5, "0")}`;
    taskSeq++;

    await prisma.$transaction(async (tx) => {
      // 과업 복사
      await tx.tbRqTask.create({
        data: {
          task_id:         newTaskId,
          prjct_id:        projectId,
          task_display_id: newDisplayId,
          task_nm:         `[복사] ${original.task_nm}`,
          ctgry_code:      original.ctgry_code,
          defn_cn:         original.defn_cn,
          dtl_cn:          original.dtl_cn,
          output_info_cn:  original.output_info_cn,
          rfp_page_no:     original.rfp_page_no,
          sort_ordr:       sortOrder,
        },
      });

      // 하위 요구사항 복사
      for (const req of original.requirements) {
        const newReqId      = `${crypto.randomUUID()}`;
        const newReqDisplay = `REQ-${String(reqSeq).padStart(5, "0")}`;
        reqSeq++;

        await tx.tbRqRequirement.create({
          data: {
            req_id:         newReqId,
            prjct_id:       projectId,
            task_id:        newTaskId,
            req_display_id: newReqDisplay,
            req_nm:         req.req_nm,
            priort_code:    req.priort_code,
            sort_ordr:      req.sort_ordr,
          },
        });

        // 사용자스토리 복사
        for (const story of req.userStories) {
          const newStoryId = `${crypto.randomUUID()}`;

          await tx.tbRqUserStory.create({
            data: {
              story_id:         newStoryId,
              req_id:           newReqId,
              story_display_id: story.story_display_id,
            },
          });

          // 인수기준 복사
          for (const ac of story.acceptanceCriteria) {
            await tx.tbRqAcceptanceCriteria.create({
              data: {
                ac_id:    `${crypto.randomUUID()}`,
                story_id: newStoryId,
              },
            });
          }
        }
      }
    });

    return apiSuccess({ taskId: newTaskId, displayId: newDisplayId }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/tasks/${taskId}/copy] DB 오류:`, err);
    return apiError("DB_ERROR", "복사 중 오류가 발생했습니다.", 500);
  }
}
