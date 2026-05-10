/**
 * exports/user-stories-data.ts — 사용자스토리 목록 데이터 조립 (서버 공용)
 *
 * 화면 GET 라우트와 export 라우트가 공유. 화면 = 엑셀 결과 일치.
 */

import { prisma } from "@/lib/prisma";

export type UserStoryListItem = {
  storyId:                 string;
  displayId:               string;
  name:                    string;
  persona:                 string;
  requirementId:           string;
  requirementDisplayId:    string;
  requirementName:         string;
  taskId:                  string | null;
  taskName:                string;
  acceptanceCriteriaCount: number;
};

/**
 * fetchProjectUserStories — 사용자스토리 목록 (요구사항·과업 join + 인수기준 수)
 *
 *   - taskId : 해당 과업 산하 요구사항의 스토리만
 *   - requirementId : 특정 요구사항의 스토리만 (taskId 보다 우선)
 *   - keyword : 스토리명·페르소나 부분 일치 (대소문자 무시)
 */
export async function fetchProjectUserStories(opts: {
  projectId:      string;
  taskId?:        string;
  requirementId?: string;
  keyword?:       string;
}): Promise<UserStoryListItem[]> {
  const { projectId, taskId, requirementId, keyword } = opts;

  // 요구사항 ID 범위 결정 — requirementId 우선, 그 다음 taskId
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
      ...(reqIds !== undefined ? { req_id: { in: reqIds } } : {}),
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
          req_id:         true,
          req_display_id: true,
          req_nm:         true,
          task_id:        true,
          task:           { select: { task_id: true, task_nm: true } },
        },
      },
      acceptanceCriteria: { select: { ac_id: true } },
    },
    orderBy: [
      { requirement: { req_display_id: "asc" } },
      { sort_ordr: "asc" },
      { creat_dt:  "desc" },
    ],
  });

  return stories.map((s) => ({
    storyId:                 s.story_id,
    displayId:               s.story_display_id,
    name:                    s.story_nm,
    persona:                 s.persona_cn ?? "",
    requirementId:           s.req_id,
    requirementDisplayId:    s.requirement.req_display_id,
    requirementName:         s.requirement.req_nm,
    taskId:                  s.requirement.task_id ?? null,
    taskName:                s.requirement.task?.task_nm ?? "미분류",
    acceptanceCriteriaCount: s.acceptanceCriteria.length,
  }));
}
