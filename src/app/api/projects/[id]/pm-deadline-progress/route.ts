/**
 * GET /api/projects/[id]/pm-deadline-progress
 *   — PM "마감 임박 × 진척률 히트맵" 위젯 데이터
 *
 * 역할:
 *   - 엔티티(단위업무/화면/기능) 중 하나를 골라, 그 엔티티 전체를 마감 근접도(6구간) ×
 *     진척률(6구간) 매트릭스로 집계한다.
 *   - 진척률은 엔티티와 무관하게 항상 기능(TbDsFunction)의 진척률 기준으로 롤업한다 —
 *     화면/단위업무는 자체 진척률 개념이 없거나(화면) 수기 입력값이라 기준이 달라서(단위업무),
 *     "진척률은 기능걸로 통일" 요청에 따름. 구현(impl_rt)/설계(design_rt) 중 어느 걸 쓸지는
 *     progressKind 로 사용자가 고른다.
 *   - pm-summary 와 완전히 독립 — 캐시를 공유하지 않고 이 위젯 전용으로 매번 새로 조회한다.
 *
 * Query:
 *   entity       — UNIT_WORK | SCREEN | FUNCTION (필수)
 *   progressKind — IMPL | DESIGN (선택, 기본 IMPL)
 *   asOf         — yyyy-MM-dd (선택, pm-summary/pm-delay-detail 과 동일 규칙 — 없으면 실제 오늘)
 *
 * 권한:
 *   - content.read (VIEWER 이상)
 */

import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { buildDeadlineProgressMatrix } from "@/lib/pm/deadlineProgress";
import { fetchDeadlineItems } from "@/lib/pm/fetchDeadlineItems";
import type { DeadlineEntityKind, ProgressKind } from "@/types/pm";

type RouteParams = { params: Promise<{ id: string }> };

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

  if (!entity || !["UNIT_WORK", "SCREEN", "FUNCTION"].includes(entity)) {
    return apiError("VALIDATION_ERROR", "entity는 UNIT_WORK/SCREEN/FUNCTION 중 하나여야 합니다.", 400);
  }
  if (progressKindParam !== null && !["IMPL", "DESIGN"].includes(progressKindParam)) {
    return apiError("VALIDATION_ERROR", "progressKind는 IMPL/DESIGN 중 하나여야 합니다.", 400);
  }
  const progressKind: ProgressKind = progressKindParam === "DESIGN" ? "DESIGN" : "IMPL";
  const todayStr = isValidDateStr(asOfParam) ? asOfParam : new Date().toISOString().slice(0, 10);

  try {
    const rawItems = await fetchDeadlineItems(projectId, entity, progressKind);
    const items = rawItems.map((r) => ({ endDate: r.endDate, progress: r.progress }));

    const matrix = buildDeadlineProgressMatrix(items, todayStr);

    return apiSuccess({ ...matrix, entity, progressKind, asOf: todayStr });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/pm-deadline-progress] DB 오류:`, err);
    return apiError("DB_ERROR", "마감 임박 현황 조회에 실패했습니다.", 500);
  }
}
