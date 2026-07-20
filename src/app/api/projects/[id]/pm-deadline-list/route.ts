/**
 * GET /api/projects/[id]/pm-deadline-list
 *   — PM 진단 "마감 임박 리스트" 카드 3종(단위업무/화면/기능) 데이터
 *
 * 역할:
 *   - "위험 워치리스트"/"우선순위 × 진척 히트맵" 자리를 대체하는 카드용 API.
 *   - 엔티티 하나를 골라 기준일 대비 마감 근접도 순으로 전체 목록을 반환한다(집계가 아니라 원본 목록).
 *   - 진척률은 다른 마감 관련 위젯들과 동일하게 항상 기능(TbDsFunction) 기준 롤업 —
 *     lib/pm/fetchDeadlineItems.ts 공용 조회 재사용.
 *
 * 정렬:
 *   - endDate 오름차순(지연 중인 것이 자동으로 맨 위, 그다음 곧 마감인 것 순)
 *   - endDate 가 없는 항목은 맨 뒤로(이름 오름차순으로 안정 정렬)
 *
 * Query:
 *   entity           — UNIT_WORK | SCREEN | FUNCTION (필수)
 *   progressKind     — IMPL | DESIGN (선택, 기본 IMPL)
 *   asOf             — yyyy-MM-dd (선택 — 없으면 실제 오늘)
 *   excludeCompleted — "true"/"false" (선택, 기본 false — progress=100 항목 제외 여부)
 *
 * 권한:
 *   - content.read (VIEWER 이상)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { computeDDay } from "@/lib/pm/deadlineProgress";
import { fetchDeadlineItems } from "@/lib/pm/fetchDeadlineItems";
import type { DeadlineEntityKind, ProgressKind, DeadlineListItem } from "@/types/pm";

type RouteParams = { params: Promise<{ id: string }> };

const ROW_LIMIT = 500;

function isValidDateStr(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const url    = new URL(request.url);
  const entity = url.searchParams.get("entity") as DeadlineEntityKind | null;
  const asOfParam = url.searchParams.get("asOf");
  const progressKindParam = url.searchParams.get("progressKind");
  const excludeCompleted = url.searchParams.get("excludeCompleted") === "true";

  if (!entity || !["UNIT_WORK", "SCREEN", "FUNCTION"].includes(entity)) {
    return apiError("VALIDATION_ERROR", "entity는 UNIT_WORK/SCREEN/FUNCTION 중 하나여야 합니다.", 400);
  }
  if (progressKindParam !== null && !["IMPL", "DESIGN"].includes(progressKindParam)) {
    return apiError("VALIDATION_ERROR", "progressKind는 IMPL/DESIGN 중 하나여야 합니다.", 400);
  }
  const progressKind: ProgressKind = progressKindParam === "DESIGN" ? "DESIGN" : "IMPL";
  const todayStr = isValidDateStr(asOfParam) ? asOfParam : new Date().toISOString().slice(0, 10);

  try {
    const raw = await fetchDeadlineItems(projectId, entity, progressKind);

    const filtered = excludeCompleted ? raw.filter((r) => r.progress < 100) : raw;

    // ── 멤버 이름 일괄 조회 (N+1 방지) ──────────────────────────────────
    const memberIds = [...new Set(filtered.map((r) => r.mberId).filter((v): v is string => !!v))];
    const members = memberIds.length > 0
      ? await prisma.tbCmMember.findMany({
          where:  { mber_id: { in: memberIds } },
          select: { mber_id: true, mber_nm: true, email_addr: true },
        })
      : [];
    const nameMap = new Map(members.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null]));

    const items: DeadlineListItem[] = filtered.map((r) => ({
      id:         r.id,
      displayId:  r.displayId,
      name:       r.name,
      href:       r.href,
      mberId:     r.mberId,
      memberName: r.mberId ? (nameMap.get(r.mberId) ?? r.mberId) : null,
      startDate:  r.startDate,
      endDate:    r.endDate,
      progress:   r.progress,
      dDay:       r.endDate ? computeDDay(r.endDate, todayStr) : null,
    }));

    // 마감일이 가까운 순 — endDate 오름차순(dDay 오름차순과 동치), null 은 맨 뒤로.
    // 2차 키로 이름 오름차순(같은 날짜끼리도, null끼리도 순서가 흔들리지 않게 안정 정렬).
    items.sort((a, b) => {
      if (a.dDay === null && b.dDay === null) return a.name.localeCompare(b.name);
      if (a.dDay === null) return 1;
      if (b.dDay === null) return -1;
      if (a.dDay !== b.dDay) return a.dDay - b.dDay;
      return a.name.localeCompare(b.name);
    });

    return apiSuccess({
      items: items.slice(0, ROW_LIMIT),
      total: items.length,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/pm-deadline-list] DB 오류:`, err);
    return apiError("DB_ERROR", "마감 임박 리스트 조회에 실패했습니다.", 500);
  }
}
