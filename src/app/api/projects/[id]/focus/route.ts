/**
 * GET /api/projects/[id]/focus — 포커스 모드 데이터 조회
 *
 * 역할:
 *   - 내가 담당한 단위업무 중 "지금 가장 먼저 해야 할 것" 1건(primary) + 다음 2건(next)
 *   - 점수화는 lib/focus/prioritize.ts 의 순수 함수
 *   - 컨텍스트 통계(open/overdue) 동봉
 *
 * 권한:
 *   - content.read
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { prioritize } from "@/lib/focus/prioritize";
import type { FocusItem, FocusResponse } from "@/types/focus";

type RouteParams = { params: Promise<{ id: string }> };

// 우선순위 산정 대상 — 미완료 + 내가 담당. 후보가 너무 많아도 정렬 비용이 큰 작업은 아니지만
// 안전을 위해 상한선 둠. 한 사용자가 500건 담당하는 케이스는 드뭄.
const CANDIDATE_LIMIT = 200;

// 응답에 노출할 다음 후보 수.
const NEXT_LIMIT = 2;

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const meId = gate.mberId;

  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayMs  = new Date(todayStr + "T00:00:00Z").getTime();
    const MS_PER_DAY = 1000 * 60 * 60 * 24;

    // 한 번의 쿼리로 후보 + 통계 모두 처리
    const [candidates, myOpenCount, myOverdueCount] = await Promise.all([
      prisma.tbDsUnitWork.findMany({
        where: {
          prjct_id:      projectId,
          asign_mber_id: meId,
          // 진행률 100 미만만 — 완료된 것은 포커스 대상 아님
          progrs_rt: { lt: 100 },
        },
        select: {
          unit_work_id:         true,
          unit_work_display_id: true,
          unit_work_nm:         true,
          end_de:               true,
          progrs_rt:            true,
          asign_mber_id:        true,
          requirement:          { select: { req_display_id: true } },
        },
        // 후보가 많을 때 가장 임박한 것부터 정렬해서 자르기
        // (점수 정렬은 후속 단계라 1차 컷은 마감 오름차순으로)
        orderBy: [
          { end_de:    "asc" },
          { progrs_rt: "asc" },
        ],
        take: CANDIDATE_LIMIT,
      }),
      // 미완료 총 건수
      prisma.tbDsUnitWork.count({
        where: { prjct_id: projectId, asign_mber_id: meId, progrs_rt: { lt: 100 } },
      }),
      // 지연 건수
      prisma.tbDsUnitWork.count({
        where: {
          prjct_id:      projectId,
          asign_mber_id: meId,
          progrs_rt:     { lt: 100 },
          end_de:        { lt: todayStr, not: null },
        },
      }),
    ]);

    // 담당자 이름 — 본인 한 명이므로 단순 조회
    const me = await prisma.tbCmMember.findUnique({
      where:  { mber_id: meId },
      select: { mber_nm: true, email_addr: true },
    });
    const myDisplayName = me?.mber_nm || me?.email_addr || null;

    // 후보 → FocusItem 정규화 (D-day 계산 포함)
    const items: FocusItem[] = candidates.map((c) => {
      const endDate = c.end_de ?? null;
      const dDay: number | null = endDate
        ? Math.round((new Date(endDate + "T00:00:00Z").getTime() - todayMs) / MS_PER_DAY)
        : null;

      return {
        itemId:        c.unit_work_id,
        displayId:     c.unit_work_display_id,
        name:          c.unit_work_nm,
        endDate,
        progress:      c.progrs_rt,
        dDay,
        assigneeName:  myDisplayName,
        reqDisplayId:  c.requirement.req_display_id,
        priorityScore: 0, // prioritize 함수가 채움
      };
    });

    const sorted = prioritize(items);

    const response: FocusResponse = {
      primary: sorted[0] ?? null,
      next:    sorted.slice(1, 1 + NEXT_LIMIT),
      context: {
        myOpenCount,
        myOverdueCount,
      },
    };

    return apiSuccess(response);
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/focus] DB 오류:`, err);
    return apiError("DB_ERROR", "포커스 데이터 조회에 실패했습니다.", 500);
  }
}
