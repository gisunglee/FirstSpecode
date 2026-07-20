/**
 * GET /api/projects/[id]/pm-analysis-detail
 *   — PM "분석 현황" 위젯 드릴다운: 실제 요구사항 이름과 진척률을 보여주는 원본 목록
 *
 * 역할:
 *   - pm-summary 의 집계 숫자(멤버별 건수·분석률)를 클릭했을 때, "정확히 어떤 요구사항이
 *     지연인지" 이름을 보여준다. 페이징 없이 최대 100건.
 *   - 지연 판정 공식은 lib/pm/delayStatus.ts buildAnalysisDelayRows 와 동일 (기준 통일)
 *
 * Query:
 *   mberId    — 특정 멤버만 (선택). UNASSIGNED_MBER_KEY("__unassigned__") 면 담당자 없는 항목만
 *   delayOnly — "true" 면 지연 항목만
 *
 * 권한:
 *   - content.read (VIEWER 이상)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { UNASSIGNED_MBER_KEY } from "@/lib/pm/delayStatus";
import type { AnalysisDetailItem } from "@/types/pm";

type RouteParams = { params: Promise<{ id: string }> };

// PM 이 한 번에 훑어볼 수 있는 상한 — pm-delay-detail 과 동일한 상한
const ROW_LIMIT = 100;
const HARD_LIMIT = 2000;

// pm-delay-detail/route.ts 의 assigneeWhere() 와 동일한 헬퍼 — 파일이 달라 재사용 대신 복제
// (요구사항 조회에만 쓰이는 좁은 헬퍼라 공용 모듈로 뽑을 만큼의 중복은 아님)
function assigneeWhere(mberId: string | undefined): { asign_mber_id?: string | null } {
  if (!mberId) return {};
  if (mberId === UNASSIGNED_MBER_KEY) return { asign_mber_id: null };
  return { asign_mber_id: mberId };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const url       = new URL(request.url);
  const mberId    = url.searchParams.get("mberId") || undefined;
  const delayOnly = url.searchParams.get("delayOnly") === "true";

  try {
    const todayStr = new Date().toISOString().slice(0, 10);

    const requirements = await prisma.tbRqRequirement.findMany({
      where: {
        prjct_id: projectId,
        ...assigneeWhere(mberId),
      },
      select: {
        req_id: true, req_display_id: true, req_nm: true,
        asign_mber_id: true, anls_bgng_de: true, anls_end_de: true, progrs_rt: true,
      },
      take: HARD_LIMIT,
    });

    // ── 멤버 이름 일괄 조회 (N+1 방지) ──────────────────────────────────
    const memberIds = [...new Set(requirements.map((r) => r.asign_mber_id).filter((v): v is string => !!v))];
    const members = memberIds.length > 0
      ? await prisma.tbCmMember.findMany({
          where:  { mber_id: { in: memberIds } },
          select: { mber_id: true, mber_nm: true, email_addr: true },
        })
      : [];
    const nameMap = new Map(members.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null]));

    const items: AnalysisDetailItem[] = requirements.map((r) => {
      const isDelayed = !!r.anls_end_de && r.anls_end_de < todayStr && r.progrs_rt < 100;
      return {
        reqId:        r.req_id,
        reqDisplayId: r.req_display_id,
        reqName:      r.req_nm,
        mberId:       r.asign_mber_id,
        memberName:   r.asign_mber_id ? (nameMap.get(r.asign_mber_id) ?? r.asign_mber_id) : null,
        startDate:    r.anls_bgng_de,
        endDate:      r.anls_end_de,
        progress:     r.progrs_rt,
        isDelayed,
      };
    });

    // ── 필터 + 정렬(지연 먼저, 그다음 진척률 낮은 순) + 상한 ────────────
    const filtered = delayOnly ? items.filter((i) => i.isDelayed) : items;
    filtered.sort((a, b) => {
      if (a.isDelayed !== b.isDelayed) return a.isDelayed ? -1 : 1;
      return a.progress - b.progress;
    });

    return apiSuccess({
      items: filtered.slice(0, ROW_LIMIT),
      total: filtered.length,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/pm-analysis-detail] DB 오류:`, err);
    return apiError("DB_ERROR", "분석 현황 상세 조회에 실패했습니다.", 500);
  }
}
