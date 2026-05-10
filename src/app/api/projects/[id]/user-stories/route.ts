/**
 * GET  /api/projects/[id]/user-stories — 사용자스토리 목록 조회 (FID-00110, FID-00111)
 * POST /api/projects/[id]/user-stories — 사용자스토리 생성 (FID-00116 신규)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { getIdPrefix } from "@/lib/idPrefix";
import { fetchProjectUserStories } from "@/lib/exports/user-stories-data";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 목록 조회 ──────────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const url          = new URL(request.url);
  const taskId       = url.searchParams.get("taskId")       || undefined;
  const requirementId = url.searchParams.get("requirementId") || undefined;
  const keyword      = url.searchParams.get("keyword")      || undefined;

  try {
    // 데이터 조회+가공 로직은 service 로 분리 — export 라우트와 동일 결과 보장
    const items = await fetchProjectUserStories({ projectId, taskId, requirementId, keyword });
    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/user-stories] DB 오류:`, err);
    return apiError("DB_ERROR", "사용자스토리 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 생성 ──────────────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { requirementId, name, persona, scenario, acceptanceCriteria } = body as {
    requirementId?:       string;
    name?:                string;
    persona?:             string;
    scenario?:            string;
    acceptanceCriteria?:  { given?: string; when?: string; then?: string }[];
  };

  if (!requirementId) return apiError("VALIDATION_ERROR", "요구사항을 선택해 주세요.", 400);
  if (!name?.trim())  return apiError("VALIDATION_ERROR", "스토리명을 입력해 주세요.", 400);
  // persona, scenario는 선택 항목 (트리에서 빠른 추가 시 생략 가능)

  // 요구사항이 이 프로젝트에 속하는지 확인
  const req = await prisma.tbRqRequirement.findUnique({ where: { req_id: requirementId } });
  if (!req || req.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "요구사항을 찾을 수 없습니다.", 404);
  }

  try {
    // 표시 ID 채번 (STR-NNNNN) — 프로젝트 내 최대값 + 1
    const maxStory = await prisma.tbRqUserStory.findFirst({
      where:   { requirement: { prjct_id: projectId } },
      orderBy: { story_display_id: "desc" },
      select:  { story_display_id: true },
    });
    const nextSeq  = maxStory
      ? (parseInt(maxStory.story_display_id.replace(/\D/g, "")) || 0) + 1
      : 1;
    const storyPrefix = await getIdPrefix(projectId, "USER_STORY");
    const displayId = `${storyPrefix}-${String(nextSeq).padStart(5, "0")}`;

    // sort_ordr: 해당 요구사항의 마지막 + 1
    const maxSort = await prisma.tbRqUserStory.findFirst({
      where:   { req_id: requirementId },
      orderBy: { sort_ordr: "desc" },
      select:  { sort_ordr: true },
    });

    const story = await prisma.$transaction(async (tx) => {
      const created = await tx.tbRqUserStory.create({
        data: {
          req_id:           requirementId,
          story_display_id: displayId,
          story_nm:         name.trim(),
          persona_cn:       persona?.trim() ?? "",
          scenario_cn:      scenario?.trim() ?? "",
          sort_ordr:        (maxSort?.sort_ordr ?? 0) + 1,
        },
      });

      // 인수기준 일괄 생성
      if (acceptanceCriteria && acceptanceCriteria.length > 0) {
        await tx.tbRqAcceptanceCriteria.createMany({
          data: acceptanceCriteria
            .filter((ac) => ac.given?.trim() || ac.when?.trim() || ac.then?.trim())
            .map((ac, idx) => ({
              story_id:  created.story_id,
              given_cn:  ac.given?.trim() || null,
              when_cn:   ac.when?.trim()  || null,
              then_cn:   ac.then?.trim()  || null,
              sort_ordr: idx,
            })),
        });
      }

      return created;
    });

    return apiSuccess({ storyId: story.story_id, displayId: story.story_display_id }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/user-stories] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}
