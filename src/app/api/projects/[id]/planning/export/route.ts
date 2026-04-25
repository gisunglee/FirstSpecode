/**
 * GET /api/projects/[id]/planning/export — 기획 데이터 JSON 내보내기
 *
 * 역할:
 *   - 과업 → 요구사항 → 사용자스토리 → 인수기준 계층 전체를 JSON으로 출력
 *   - Claude 프로젝트에 붙여넣어 AI와 함께 수정한 뒤 bulk-import로 재등록하는 용도
 *
 * Query Params:
 *   taskId (optional) — 특정 과업만 내보낼 때 과업 UUID
 *                       생략 시 프로젝트 전체 과업 내보내기
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

  // 멤버십 확인 (조회는 모든 역할 가능)
  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  const url    = new URL(request.url);
  const taskId = url.searchParams.get("taskId") || undefined;

  try {
    const tasks = await prisma.tbRqTask.findMany({
      where: {
        prjct_id: projectId,
        // taskId가 주어지면 해당 과업만, 없으면 전체
        ...(taskId ? { task_id: taskId } : {}),
      },
      include: {
        requirements: {
          orderBy: { sort_ordr: "asc" },
          include: {
            userStories: {
              orderBy: { sort_ordr: "asc" },
              include: {
                acceptanceCriteria: { orderBy: { sort_ordr: "asc" } },
              },
            },
          },
        },
      },
      orderBy: { sort_ordr: "asc" },
    });

    // DB 필드 → AI-친화적 JSON 키 변환
    const result = {
      tasks: tasks.map((t) => ({
        systemId:    t.task_id,
        displayId:   t.task_display_id,
        name:        t.task_nm,
        category:    t.ctgry_code,
        definition:  t.defn_cn  ?? "",
        outputInfo:  t.output_info_cn ?? "",
        content:     t.dtl_cn   ?? "",
        rfpPage:     t.rfp_page_no ?? "",   // [2026-04-25] P2: 라운드트립 데이터 손실 방지
        requirements: t.requirements.map((r) => ({
          systemId:       r.req_id,
          displayId:      r.req_display_id,
          name:           r.req_nm,
          originalContent: r.orgnl_cn    ?? "",
          currentContent:  r.curncy_cn   ?? "",
          detailSpec:      r.spec_cn     ?? "",
          discussionMd:    r.analy_cn    ?? "",
          priority:        r.priort_code,
          source:          r.src_code    ?? "",
          rfpPage:         r.rfp_page_no ?? "",  // [2026-04-25] P2: 라운드트립 데이터 손실 방지
          userStories: r.userStories.map((s) => ({
            systemId:  s.story_id,
            displayId: s.story_display_id,
            name:      s.story_nm,
            persona:   s.persona_cn  ?? "",
            scenario:  s.scenario_cn ?? "",
            acceptanceCriteria: s.acceptanceCriteria.map((ac) => ({
              given: ac.given_cn ?? "",
              when:  ac.when_cn  ?? "",
              then:  ac.then_cn  ?? "",
            })),
          })),
        })),
      })),
    };

    return apiSuccess(result);
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/planning/export] DB 오류:`, err);
    return apiError("DB_ERROR", "내보내기 중 오류가 발생했습니다.", 500);
  }
}
