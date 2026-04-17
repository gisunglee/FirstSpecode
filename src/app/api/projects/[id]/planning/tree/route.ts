/**
 * GET /api/projects/[id]/planning/tree — 기획 트리 전체 로드 (FID-00126)
 *
 * 과업 → 요구사항 → 사용자스토리 계층을 단일 쿼리로 반환
 * sort_ordr 기준 정렬 유지
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    // 과업 + 요구사항 + 사용자스토리 일괄 조회 (3 round trip 병렬)
    const [tasks, requirements, stories] = await Promise.all([
      prisma.tbRqTask.findMany({
        where:   { prjct_id: projectId },
        orderBy: { sort_ordr: "asc" },
        select:  { task_id: true, task_display_id: true, task_nm: true, ctgry_code: true, sort_ordr: true },
      }),
      prisma.tbRqRequirement.findMany({
        where:   { prjct_id: projectId },
        orderBy: { sort_ordr: "asc" },
        select:  { req_id: true, req_display_id: true, req_nm: true, priort_code: true, src_code: true, task_id: true, sort_ordr: true },
      }),
      prisma.tbRqUserStory.findMany({
        where:   { requirement: { prjct_id: projectId } },
        orderBy: { sort_ordr: "asc" },
        select:  { story_id: true, story_display_id: true, story_nm: true, req_id: true, sort_ordr: true },
      }),
    ]);

    // 클라이언트 쪽에서 트리 구성할 수 있도록 flat 구조로 반환
    // 과업별로 하위 요구사항 개수(reqCount), 요구사항별 스토리 개수(storyCount) 포함
    const reqMap = new Map<string, typeof requirements[number][]>();
    for (const req of requirements) {
      const key = req.task_id ?? "__none__";
      if (!reqMap.has(key)) reqMap.set(key, []);
      reqMap.get(key)!.push(req);
    }

    const storyMap = new Map<string, typeof stories[number][]>();
    for (const s of stories) {
      if (!storyMap.has(s.req_id)) storyMap.set(s.req_id, []);
      storyMap.get(s.req_id)!.push(s);
    }

    const taskNodes = tasks.map((t) => {
      const reqs = reqMap.get(t.task_id) ?? [];
      return {
        taskId:       t.task_id,
        displayId:    t.task_display_id,
        name:         t.task_nm,
        category:     t.ctgry_code,
        reqCount:     reqs.length,
        requirements: reqs.map((r) => ({
          reqId:      r.req_id,
          displayId:  r.req_display_id,
          name:       r.req_nm,
          priority:   r.priort_code,
          source:     r.src_code,
          storyCount: (storyMap.get(r.req_id) ?? []).length,
          stories:    (storyMap.get(r.req_id) ?? []).map((s) => ({
            storyId:   s.story_id,
            displayId: s.story_display_id,
            name:      s.story_nm,
          })),
        })),
      };
    });

    // 미분류(task_id = null) 요구사항
    const unclassifiedReqs = (reqMap.get("__none__") ?? []).map((r) => ({
      reqId:      r.req_id,
      displayId:  r.req_display_id,
      name:       r.req_nm,
      priority:   r.priort_code,
      source:     r.src_code,
      storyCount: (storyMap.get(r.req_id) ?? []).length,
      stories:    (storyMap.get(r.req_id) ?? []).map((s) => ({
        storyId:   s.story_id,
        displayId: s.story_display_id,
        name:      s.story_nm,
      })),
    }));

    return apiSuccess({
      tasks:              taskNodes,
      unclassifiedReqs,
      totalTaskCount:     tasks.length,
      totalReqCount:      requirements.length,
      totalStoryCount:    stories.length,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/planning/tree] DB 오류:`, err);
    return apiError("DB_ERROR", "기획 트리 조회에 실패했습니다.", 500);
  }
}
