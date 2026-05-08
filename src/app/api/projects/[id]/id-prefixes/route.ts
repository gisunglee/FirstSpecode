/**
 * GET /api/projects/[id]/id-prefixes — 프로젝트 표시 ID prefix 7종 일괄 조회
 *
 * 역할:
 *   - 7개 엔티티(요구사항/스토리/과업/단위업무/화면/영역/기능)의 prefix 를
 *     한 번의 요청으로 반환.
 *   - 신규 등록 화면의 표시 ID placeholder("AR-XXXXX (미 입력 시 자동 생성)") 표시용.
 *   - 변경 빈도가 낮으므로 클라이언트에서 staleTime 5분 캐시 적용.
 *
 * 응답:
 *   { data: { REQUIREMENT: "REQ", USER_STORY: "STR", TASK: "SFR",
 *             UNIT_WORK: "UW",   SCREEN: "SCR",     AREA: "AR", FUNCTION: "FN" } }
 *
 * 권한:
 *   - content.read — 프로젝트 멤버라면 모두 조회 가능.
 */

import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess } from "@/lib/apiResponse";
import { getIdPrefix, type EntityKind } from "@/lib/idPrefix";

type RouteParams = { params: Promise<{ id: string }> };

const KINDS: EntityKind[] = [
  "REQUIREMENT", "USER_STORY", "TASK",
  "UNIT_WORK", "SCREEN", "AREA", "FUNCTION",
];

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  // 7회 병렬 조회 — getIdPrefix 가 미설정 시 fallback 까지 처리
  const entries = await Promise.all(
    KINDS.map(async (kind) => [kind, await getIdPrefix(projectId, kind)] as const)
  );

  const prefixes = Object.fromEntries(entries) as Record<EntityKind, string>;
  return apiSuccess(prefixes);
}
