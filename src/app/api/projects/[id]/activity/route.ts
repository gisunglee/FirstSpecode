/**
 * GET /api/projects/[id]/activity — 활동 피드 조회
 *
 * 역할:
 *   - 프로젝트의 변경/검토요청/AI완료 이벤트를 시간 역순으로 통합 반환
 *   - 무한 스크롤용 커서 페이지네이션
 *
 * Query:
 *   range?  — today | 7d | 30d | all (기본 7d)
 *   cursor? — ISO timestamp (이보다 옛 항목만 반환)
 *   limit?  — 1~100 (기본 50)
 *
 * 권한:
 *   - content.read (VIEWER 이상)
 *
 * 격리:
 *   - 도메인 로직은 lib/activity/fetchEvents.ts 에 분리.
 *   - 이 파일은 권한·파라미터 파싱·응답 포장만 담당.
 */

import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { fetchActivityEvents } from "@/lib/activity/fetchEvents";
import {
  ACTIVITY_RANGE_DAYS,
  type ActivityFeedResponse,
  type ActivityRangeKey,
} from "@/types/activity";

type RouteParams = { params: Promise<{ id: string }> };

function isRangeKey(v: string | null): v is ActivityRangeKey {
  return v === "today" || v === "7d" || v === "30d" || v === "all";
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const url        = new URL(request.url);
  const rangeRaw   = url.searchParams.get("range");
  const cursorRaw  = url.searchParams.get("cursor");
  const limitRaw   = url.searchParams.get("limit");

  // 기본값 7일 — 활동량이 많은 프로젝트에서 한 번에 너무 멀리 거슬러 올라가지 않도록.
  const range: ActivityRangeKey = isRangeKey(rangeRaw) ? rangeRaw : "7d";

  // 기간 → since (Date)
  let since: Date | undefined;
  const days = ACTIVITY_RANGE_DAYS[range];
  if (days !== null) {
    since = new Date();
    since.setDate(since.getDate() - days);
  }

  // cursor 파싱 — 잘못된 형식은 무시(첫 페이지로 폴백)
  let cursor: Date | undefined;
  if (cursorRaw) {
    const parsed = new Date(cursorRaw);
    if (!Number.isNaN(parsed.getTime())) cursor = parsed;
  }

  const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;

  try {
    const { events, nextCursor } = await fetchActivityEvents({
      projectId, cursor, since, limit,
    });
    const response: ActivityFeedResponse = { events, nextCursor };
    return apiSuccess(response);
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/activity] DB 오류:`, err);
    return apiError("DB_ERROR", "활동 피드 조회에 실패했습니다.", 500);
  }
}
