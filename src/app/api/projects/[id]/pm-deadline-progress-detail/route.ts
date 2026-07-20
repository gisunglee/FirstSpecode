/**
 * GET /api/projects/[id]/pm-deadline-progress-detail
 *   — PM "마감 임박 × 진척률 히트맵" 위젯 드릴다운: 셀 하나(엔티티×마감버킷×진척버킷)에
 *     해당하는 실제 항목 목록
 *
 * 역할:
 *   - pm-deadline-progress 의 집계 숫자를 클릭했을 때 실제 이름·담당자·바로가기 링크를 보여준다.
 *   - 분류 기준은 lib/pm/deadlineProgress.ts 의 computeDDay/classifyDeadline/classifyProgress
 *     와 동일 — 위젯 숫자와 상세 목록이 어긋나지 않게 로직을 그대로 재사용한다.
 *   - 페이징 없이 최대 100건.
 *
 * Query (전부 필수, progressKind만 선택):
 *   entity         — UNIT_WORK | SCREEN | FUNCTION
 *   progressKind   — IMPL | DESIGN (선택, 기본 IMPL — pm-deadline-progress 호출 때 쓴 값 그대로 전달)
 *   asOf           — yyyy-MM-dd (기준일 — pm-deadline-progress 호출 때 쓴 값 그대로 전달)
 *   deadlineBucket — OVERDUE | D1 | D3 | D5 | D7 | D8_PLUS
 *   progressBucket — P0 | P1_25 | P26_50 | P51_75 | P76_99 | P100
 *
 * 권한:
 *   - content.read (VIEWER 이상)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { computeDDay, classifyDeadline, classifyProgress } from "@/lib/pm/deadlineProgress";
import { fetchDeadlineItems } from "@/lib/pm/fetchDeadlineItems";
import type {
  DeadlineEntityKind, DeadlineBucket, ProgressBucket, DeadlineProgressDetailItem, ProgressKind,
} from "@/types/pm";

type RouteParams = { params: Promise<{ id: string }> };

const ROW_LIMIT  = 100;

const DEADLINE_BUCKETS: DeadlineBucket[] = ["OVERDUE", "D1", "D3", "D5", "D7", "D8_PLUS"];
const PROGRESS_BUCKETS: ProgressBucket[] = ["P0", "P1_25", "P26_50", "P51_75", "P76_99", "P100"];

function isValidDateStr(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const url            = new URL(request.url);
  const entity          = url.searchParams.get("entity") as DeadlineEntityKind | null;
  const asOfParam        = url.searchParams.get("asOf");
  const deadlineBucket   = url.searchParams.get("deadlineBucket") as DeadlineBucket | null;
  const progressBucket   = url.searchParams.get("progressBucket") as ProgressBucket | null;
  const progressKindParam = url.searchParams.get("progressKind");

  if (!entity || !["UNIT_WORK", "SCREEN", "FUNCTION"].includes(entity)) {
    return apiError("VALIDATION_ERROR", "entity는 UNIT_WORK/SCREEN/FUNCTION 중 하나여야 합니다.", 400);
  }
  if (!isValidDateStr(asOfParam)) {
    return apiError("VALIDATION_ERROR", "asOf는 yyyy-MM-dd 형식이어야 합니다.", 400);
  }
  if (!deadlineBucket || !DEADLINE_BUCKETS.includes(deadlineBucket)) {
    return apiError("VALIDATION_ERROR", "deadlineBucket 값이 올바르지 않습니다.", 400);
  }
  if (!progressBucket || !PROGRESS_BUCKETS.includes(progressBucket)) {
    return apiError("VALIDATION_ERROR", "progressBucket 값이 올바르지 않습니다.", 400);
  }
  if (progressKindParam !== null && !["IMPL", "DESIGN"].includes(progressKindParam)) {
    return apiError("VALIDATION_ERROR", "progressKind는 IMPL/DESIGN 중 하나여야 합니다.", 400);
  }
  const progressKind: ProgressKind = progressKindParam === "DESIGN" ? "DESIGN" : "IMPL";
  const todayStr = asOfParam;

  try {
    const raw = await fetchDeadlineItems(projectId, entity, progressKind);

    // 마감일 없는 항목은 이 그리드 대상이 아님(요약 API의 excludedNoDeadline과 동일 취급)
    const filtered = raw.filter((r) => {
      if (!r.endDate) return false;
      const dDay = computeDDay(r.endDate, todayStr);
      return classifyDeadline(dDay) === deadlineBucket && classifyProgress(r.progress) === progressBucket;
    });

    // ── 멤버 이름 일괄 조회 (N+1 방지) ──────────────────────────────────
    const memberIds = [...new Set(filtered.map((r) => r.mberId).filter((v): v is string => !!v))];
    const members = memberIds.length > 0
      ? await prisma.tbCmMember.findMany({
          where:  { mber_id: { in: memberIds } },
          select: { mber_id: true, mber_nm: true, email_addr: true },
        })
      : [];
    const nameMap = new Map(members.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null]));

    const items: DeadlineProgressDetailItem[] = filtered.map((r) => ({
      id:         r.id,
      displayId:  r.displayId,
      name:       r.name,
      href:       r.href,
      mberId:     r.mberId,
      memberName: r.mberId ? (nameMap.get(r.mberId) ?? r.mberId) : null,
      startDate:  r.startDate,
      endDate:    r.endDate,
      progress:   r.progress,
    }));

    // 진척률 오름차순(덜 된 것부터) — 다른 드릴다운 모달들과 동일한 정렬 관례
    items.sort((a, b) => a.progress - b.progress);

    return apiSuccess({
      items: items.slice(0, ROW_LIMIT),
      total: items.length,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/pm-deadline-progress-detail] DB 오류:`, err);
    return apiError("DB_ERROR", "마감 임박 현황 상세 조회에 실패했습니다.", 500);
  }
}
