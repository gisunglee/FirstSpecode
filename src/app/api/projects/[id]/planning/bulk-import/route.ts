/**
 * POST /api/projects/[id]/planning/bulk-import — 기획 데이터 일괄 등록/수정
 *
 * 역할:
 *   - Claude에서 설계한 과업·요구사항·사용자스토리를 JSON으로 한 번에 등록
 *   - systemId 있음 → UUID로 조회 후 UPDATE
 *   - systemId 없음 → 신규 CREATE (displayId 자동 채번)
 *   - 사용자스토리 수정 시 acceptanceCriteria: 기존 전체 삭제 후 재생성 (단순화)
 *
 * Request Body:
 *   {
 *     tasks: [
 *       {
 *         systemId?: string,       // 수정 시 과업 UUID. 없으면 신규
 *         name: string,
 *         category: string,        // NEW_DEV | IMPROVE | MAINTAIN
 *         definition?: string,
 *         outputInfo?: string,
 *         content?: string,
 *         requirements: [
 *           {
 *             systemId?: string,   // 수정 시 요구사항 UUID. 없으면 신규
 *             name: string,
 *             originalContent?: string,
 *             currentContent?: string,
 *             detailSpec?: string,
 *             discussionMd?: string,
 *             priority?: string,   // HIGH | MEDIUM | LOW
 *             source?: string,
 *             userStories: [
 *               {
 *                 systemId?: string, // 수정 시 스토리 UUID. 없으면 신규
 *                 name: string,
 *                 persona?: string,
 *                 scenario?: string,
 *                 acceptanceCriteria?: [{ given?, when?, then? }]
 *               }
 *             ]
 *           }
 *         ]
 *       }
 *     ]
 *   }
 *
 * Response:
 *   {
 *     created: { tasks, requirements, stories },
 *     updated: { tasks, requirements, stories },
 *     skipped: { tasks, requirements, stories }  // systemId가 있지만 DB에 없는 경우
 *   }
 */

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

// Prisma 인터랙티브 트랜잭션 클라이언트 타입
// 채번 헬퍼에 tx를 넘겨야 트랜잭션 내 미커밋 데이터를 읽을 수 있음
// (전역 prisma 사용 시 동일 임포트에서 신규 항목 2개 이상이면 중복 displayId 발생)
type TxClient = Prisma.TransactionClient;

type RouteParams = { params: Promise<{ id: string }> };

// ── 입력 타입 ────────────────────────────────────────────────────────────────

type AcceptanceCriteriaInput = {
  given?: string;
  when?:  string;
  then?:  string;
};

type UserStoryInput = {
  systemId?:           string;
  name:                string;
  persona?:            string;
  scenario?:           string;
  acceptanceCriteria?: AcceptanceCriteriaInput[];
};

type RequirementInput = {
  systemId?:       string;
  name:            string;
  originalContent?: string;
  currentContent?:  string;
  detailSpec?:      string;
  discussionMd?:    string;
  priority?:        string;
  source?:          string;
  userStories?:     UserStoryInput[];
};

type TaskInput = {
  systemId?:    string;
  name:         string;
  category:     string;
  definition?:  string;
  outputInfo?:  string;
  content?:     string;
  requirements?: RequirementInput[];
};

// ── displayId 채번 헬퍼 ──────────────────────────────────────────────────────
// 반드시 트랜잭션 클라이언트(tx)를 받아서 호출해야 함
// → 동일 트랜잭션 내 미커밋 INSERT를 읽어야 중복 displayId를 막을 수 있음

async function nextTaskDisplayId(projectId: string, tx: TxClient): Promise<string> {
  const max = await tx.tbRqTask.findFirst({
    where:   { prjct_id: projectId },
    orderBy: { task_display_id: "desc" },
    select:  { task_display_id: true },
  });
  const seq = max ? (parseInt(max.task_display_id.replace(/\D/g, "")) || 0) + 1 : 1;
  return `SFR-${String(seq).padStart(5, "0")}`;
}

async function nextReqDisplayId(projectId: string, tx: TxClient): Promise<string> {
  const max = await tx.tbRqRequirement.findFirst({
    where:   { prjct_id: projectId },
    orderBy: { req_display_id: "desc" },
    select:  { req_display_id: true },
  });
  const seq = max ? (parseInt(max.req_display_id.replace(/\D/g, "")) || 0) + 1 : 1;
  return `REQ-${String(seq).padStart(5, "0")}`;
}

async function nextStoryDisplayId(projectId: string, tx: TxClient): Promise<string> {
  const max = await tx.tbRqUserStory.findFirst({
    where:   { requirement: { prjct_id: projectId } },
    orderBy: { story_display_id: "desc" },
    select:  { story_display_id: true },
  });
  const seq = max ? (parseInt(max.story_display_id.replace(/\D/g, "")) || 0) + 1 : 1;
  return `STR-${String(seq).padStart(5, "0")}`;
}

async function nextTaskSortOrder(projectId: string, tx: TxClient): Promise<number> {
  const max = await tx.tbRqTask.findFirst({
    where:   { prjct_id: projectId },
    orderBy: { sort_ordr: "desc" },
    select:  { sort_ordr: true },
  });
  return (max?.sort_ordr ?? 0) + 1;
}

async function nextReqSortOrder(projectId: string, taskId: string | null, tx: TxClient): Promise<number> {
  const max = await tx.tbRqRequirement.findFirst({
    where:   { prjct_id: projectId, task_id: taskId },
    orderBy: { sort_ordr: "desc" },
    select:  { sort_ordr: true },
  });
  return (max?.sort_ordr ?? 0) + 1;
}

async function nextStorySortOrder(reqId: string, tx: TxClient): Promise<number> {
  const max = await tx.tbRqUserStory.findFirst({
    where:   { req_id: reqId },
    orderBy: { sort_ordr: "desc" },
    select:  { sort_ordr: true },
  });
  return (max?.sort_ordr ?? 0) + 1;
}

// ── POST 핸들러 ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

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

  const { tasks } = body as { tasks?: TaskInput[] };
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return apiError("VALIDATION_ERROR", "tasks 배열이 비어 있습니다.", 400);
  }

  // ── 카운터 ────────────────────────────────────────────────────────────────
  const result = {
    created: { tasks: 0, requirements: 0, stories: 0 },
    updated: { tasks: 0, requirements: 0, stories: 0 },
    skipped: { tasks: 0, requirements: 0, stories: 0 },
  };

  try {
    // 트랜잭션으로 묶어서 부분 실패 방지
    await prisma.$transaction(async (tx) => {
      for (const taskInput of tasks) {
        if (!taskInput.name?.trim()) continue; // 이름 없는 항목 스킵

        let taskId: string;

        if (taskInput.systemId) {
          // ── 과업 수정 ──────────────────────────────────────────────────────
          const existing = await tx.tbRqTask.findUnique({
            where: { task_id: taskInput.systemId },
          });
          if (!existing || existing.prjct_id !== projectId) {
            // systemId가 이 프로젝트에 속하지 않으면 스킵 (보안)
            result.skipped.tasks++;
            continue;
          }
          await tx.tbRqTask.update({
            where: { task_id: taskInput.systemId },
            data: {
              task_nm:        taskInput.name.trim(),
              ctgry_code:     taskInput.category || existing.ctgry_code,
              defn_cn:        taskInput.definition?.trim()  ?? existing.defn_cn,
              output_info_cn: taskInput.outputInfo?.trim()  ?? existing.output_info_cn,
              dtl_cn:         taskInput.content?.trim()     ?? existing.dtl_cn,
              mdfcn_dt:       new Date(),
            },
          });
          taskId = taskInput.systemId;
          result.updated.tasks++;
        } else {
          // ── 과업 신규 등록 ─────────────────────────────────────────────────
          const displayId  = await nextTaskDisplayId(projectId, tx);
          const sortOrder  = await nextTaskSortOrder(projectId, tx);
          const created    = await tx.tbRqTask.create({
            data: {
              prjct_id:        projectId,
              task_display_id: displayId,
              task_nm:         taskInput.name.trim(),
              ctgry_code:      taskInput.category || "NEW_DEV",
              defn_cn:         taskInput.definition?.trim()  || null,
              output_info_cn:  taskInput.outputInfo?.trim()  || null,
              dtl_cn:          taskInput.content?.trim()     || null,
              sort_ordr:       sortOrder,
            },
          });
          taskId = created.task_id;
          result.created.tasks++;
        }

        // ── 요구사항 처리 ──────────────────────────────────────────────────
        for (const reqInput of taskInput.requirements ?? []) {
          if (!reqInput.name?.trim()) continue;

          let reqId: string;

          if (reqInput.systemId) {
            // 수정
            const existing = await tx.tbRqRequirement.findUnique({
              where: { req_id: reqInput.systemId },
            });
            if (!existing || existing.prjct_id !== projectId) {
              result.skipped.requirements++;
              continue;
            }
            await tx.tbRqRequirement.update({
              where: { req_id: reqInput.systemId },
              data: {
                task_id:      taskId,
                req_nm:       reqInput.name.trim(),
                priort_code:  reqInput.priority  ?? existing.priort_code,
                src_code:     reqInput.source     ?? existing.src_code,
                orgnl_cn:     reqInput.originalContent?.trim() ?? existing.orgnl_cn,
                curncy_cn:    reqInput.currentContent?.trim()  ?? existing.curncy_cn,
                spec_cn:      reqInput.detailSpec?.trim()      ?? existing.spec_cn,
                analy_cn:     reqInput.discussionMd?.trim()    ?? existing.analy_cn,
                mdfcn_dt:     new Date(),
              },
            });
            reqId = reqInput.systemId;
            result.updated.requirements++;
          } else {
            // 신규
            const displayId = await nextReqDisplayId(projectId, tx);
            const sortOrder = await nextReqSortOrder(projectId, taskId, tx);
            const created   = await tx.tbRqRequirement.create({
              data: {
                prjct_id:       projectId,
                task_id:        taskId,
                req_display_id: displayId,
                req_nm:         reqInput.name.trim(),
                priort_code:    reqInput.priority || "MEDIUM",
                src_code:       reqInput.source   || "RFP",
                orgnl_cn:       reqInput.originalContent?.trim() || null,
                curncy_cn:      reqInput.currentContent?.trim()  || null,
                spec_cn:        reqInput.detailSpec?.trim()      || null,
                analy_cn:       reqInput.discussionMd?.trim()    || null,
                sort_ordr:      sortOrder,
              },
            });
            reqId = created.req_id;
            result.created.requirements++;
          }

          // ── 사용자스토리 처리 ────────────────────────────────────────────
          for (const storyInput of reqInput.userStories ?? []) {
            if (!storyInput.name?.trim()) continue;

            if (storyInput.systemId) {
              // 수정 — 인수기준은 기존 삭제 후 재생성 (순서 보장, 단순화)
              const existing = await tx.tbRqUserStory.findUnique({
                where: { story_id: storyInput.systemId },
              });
              if (!existing) {
                result.skipped.stories++;
                continue;
              }
              await tx.tbRqUserStory.update({
                where: { story_id: storyInput.systemId },
                data: {
                  req_id:      reqId,
                  story_nm:    storyInput.name.trim(),
                  persona_cn:  storyInput.persona?.trim()  ?? existing.persona_cn,
                  scenario_cn: storyInput.scenario?.trim() ?? existing.scenario_cn,
                  mdfcn_dt:    new Date(),
                },
              });
              // acceptanceCriteria가 입력된 경우에만 재생성
              if (storyInput.acceptanceCriteria !== undefined) {
                await tx.tbRqAcceptanceCriteria.deleteMany({
                  where: { story_id: storyInput.systemId },
                });
                const validAcs = (storyInput.acceptanceCriteria ?? []).filter(
                  (ac) => ac.given?.trim() || ac.when?.trim() || ac.then?.trim()
                );
                if (validAcs.length > 0) {
                  await tx.tbRqAcceptanceCriteria.createMany({
                    data: validAcs.map((ac, idx) => ({
                      story_id:  storyInput.systemId!,
                      given_cn:  ac.given?.trim() || null,
                      when_cn:   ac.when?.trim()  || null,
                      then_cn:   ac.then?.trim()  || null,
                      sort_ordr: idx,
                    })),
                  });
                }
              }
              result.updated.stories++;
            } else {
              // 신규
              const displayId = await nextStoryDisplayId(projectId, tx);
              const sortOrder = await nextStorySortOrder(reqId, tx);
              const created   = await tx.tbRqUserStory.create({
                data: {
                  req_id:           reqId,
                  story_display_id: displayId,
                  story_nm:         storyInput.name.trim(),
                  persona_cn:       storyInput.persona?.trim()  ?? "",
                  scenario_cn:      storyInput.scenario?.trim() ?? "",
                  sort_ordr:        sortOrder,
                },
              });
              // 인수기준 일괄 생성
              const validAcs = (storyInput.acceptanceCriteria ?? []).filter(
                (ac) => ac.given?.trim() || ac.when?.trim() || ac.then?.trim()
              );
              if (validAcs.length > 0) {
                await tx.tbRqAcceptanceCriteria.createMany({
                  data: validAcs.map((ac, idx) => ({
                    story_id:  created.story_id,
                    given_cn:  ac.given?.trim() || null,
                    when_cn:   ac.when?.trim()  || null,
                    then_cn:   ac.then?.trim()  || null,
                    sort_ordr: idx,
                  })),
                });
              }
              result.created.stories++;
            }
          }
        }
      }
    }, { timeout: 30000 }); // 대용량 JSON 처리 시 타임아웃 여유

    return apiSuccess({
      result,
      summary: `과업 ${result.created.tasks + result.updated.tasks}개 ` +
               `(신규 ${result.created.tasks}, 수정 ${result.updated.tasks}), ` +
               `요구사항 ${result.created.requirements + result.updated.requirements}개 ` +
               `(신규 ${result.created.requirements}, 수정 ${result.updated.requirements}), ` +
               `스토리 ${result.created.stories + result.updated.stories}개 ` +
               `(신규 ${result.created.stories}, 수정 ${result.updated.stories}) 처리 완료`,
    });
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/planning/bulk-import] DB 오류:`, err);
    return apiError("DB_ERROR", "일괄 등록 중 오류가 발생했습니다.", 500);
  }
}
