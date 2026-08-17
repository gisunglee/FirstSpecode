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
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { createIdPrefixCache } from "@/lib/idPrefix";
import { maxDisplayIdSeq } from "@/lib/nextDisplayId";

type RouteParams = { params: Promise<{ id: string; taskId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, taskId } = await params;

  // 복사는 새 과업 생성과 동일한 권한을 사용한다. VIEWER는 content.create에서 차단된다.
  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

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

    // 같은 트랜잭션에서 과업 1건 + 다수 요구사항을 채번하므로 캐시로 prefix 조회 절약
    const prefixCache = createIdPrefixCache(projectId);
    const taskPrefix  = await prefixCache.get("TASK");
    const reqPrefix   = await prefixCache.get("REQUIREMENT");

    // 채번 베이스값 조회 — "PREFIX-숫자" 형식에 맞는 값만 골라 최댓값을 찾는다
    // (형식을 벗어난 표시ID가 하나라도 있으면 문자열 정렬 기반 채번이 깨지므로 사용 금지)
    const [existingTasks, existingReqs, maxSort] = await Promise.all([
      prisma.tbRqTask.findMany({
        where:  { prjct_id: projectId },
        select: { task_display_id: true },
      }),
      prisma.tbRqRequirement.findMany({
        where:  { prjct_id: projectId },
        select: { req_display_id: true },
      }),
      prisma.tbRqTask.findFirst({
        where: { prjct_id: projectId },
        orderBy: { sort_ordr: "desc" },
        select: { sort_ordr: true },
      }),
    ]);

    let taskSeq = maxDisplayIdSeq(existingTasks.map((t) => t.task_display_id), taskPrefix) + 1;
    let reqSeq  = maxDisplayIdSeq(existingReqs.map((r) => r.req_display_id), reqPrefix) + 1;
    const sortOrder = (maxSort?.sort_ordr ?? 0) + 1;

    const newTaskId = `${crypto.randomUUID()}`;
    const newDisplayId = `${taskPrefix}-${String(taskSeq).padStart(5, "0")}`;
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
          creat_mber_id:   gate.mberId,
        },
      });

      // 하위 요구사항 복사
      for (const req of original.requirements) {
        const newReqId      = `${crypto.randomUUID()}`;
        const newReqDisplay = `${reqPrefix}-${String(reqSeq).padStart(5, "0")}`;
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
            creat_mber_id:  gate.mberId,
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
              creat_mber_id:    gate.mberId,
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
