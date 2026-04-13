/**
 * GET /api/projects/[id]/impl-tree — 구현 대상 선택용 설계 트리 조회
 *
 * 역할:
 *   - refType/refId로 소속 단위업무를 역추적
 *   - 해당 단위업무 하위 전체 트리(UW → SCR → AR → FN) 반환
 *   - 현재 엔티티 기준 자동 선택 ID 목록(selectedIds) 계산
 *
 * Query:
 *   - refType: FUNCTION | AREA | SCREEN | UNIT_WORK
 *   - refId:   대상 엔티티 UUID
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// ── 응답 트리 노드 타입 ─────────────────────────────────────────────────────
type TreeNode = {
  id: string;
  name: string;
  displayId: string;
  type: "UNIT_WORK" | "SCREEN" | "AREA" | "FUNCTION";
  children: TreeNode[];
};

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  // 멤버십 확인
  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  // ── 파라미터 파싱 ─────────────────────────────────────────────────────────
  const url     = new URL(request.url);
  const refType = url.searchParams.get("refType");
  const refId   = url.searchParams.get("refId");

  if (!refType || !refId) {
    return apiError("VALIDATION_ERROR", "refType과 refId는 필수입니다.", 400);
  }

  const validTypes = ["FUNCTION", "AREA", "SCREEN", "UNIT_WORK"];
  if (!validTypes.includes(refType)) {
    return apiError("VALIDATION_ERROR", `refType은 ${validTypes.join(", ")} 중 하나여야 합니다.`, 400);
  }

  try {
    // ── ① unitWorkId 역추적 + 선택 경로 수집 ────────────────────────────────
    const { unitWorkId, pathIds } = await resolveUnitWork(refType, refId);

    if (!unitWorkId) {
      return apiError("VALIDATION_ERROR", "단위업무가 지정되지 않은 항목입니다.", 400);
    }

    // ── ② 단위업무 하위 전체 트리 조회 ──────────────────────────────────────
    const uw = await prisma.tbDsUnitWork.findUnique({
      where: { unit_work_id: unitWorkId },
      include: {
        screens: {
          orderBy: { sort_ordr: "asc" },
          include: {
            areas: {
              orderBy: { sort_ordr: "asc" },
              include: {
                functions: { orderBy: { sort_ordr: "asc" } },
              },
            },
          },
        },
      },
    });

    if (!uw) {
      return apiError("NOT_FOUND", "단위업무를 찾을 수 없습니다.", 404);
    }

    // ── ③ 트리 변환 ────────────────────────────────────────────────────────
    const tree: TreeNode = {
      id:        uw.unit_work_id,
      name:      uw.unit_work_nm,
      displayId: uw.unit_work_display_id,
      type:      "UNIT_WORK",
      children:  uw.screens.map((s) => ({
        id:        s.scrn_id,
        name:      s.scrn_nm,
        displayId: s.scrn_display_id,
        type:      "SCREEN" as const,
        children:  s.areas.map((a) => ({
          id:        a.area_id,
          name:      a.area_nm,
          displayId: a.area_display_id,
          type:      "AREA" as const,
          children:  a.functions.map((f) => ({
            id:        f.func_id,
            name:      f.func_nm,
            displayId: f.func_display_id,
            type:      "FUNCTION" as const,
            children:  [],
          })),
        })),
      })),
    };

    // ── ④ selectedIds 계산 ─────────────────────────────────────────────────
    // pathIds(상위 체인) + refId 하위 자손 전부
    const selectedIds = new Set<string>(pathIds);
    if (refType !== "FUNCTION") {
      // 현재 엔티티의 모든 자손을 선택 대상에 추가
      const refNode = findNode(tree, refId);
      if (refNode) collectAllIds(refNode, selectedIds);
    }

    return apiSuccess({
      tree,
      selectedIds: Array.from(selectedIds),
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/impl-tree]`, err);
    return apiError("DB_ERROR", "트리 조회 중 오류가 발생했습니다.", 500);
  }
}

// ── unitWorkId 역추적 — refType별 상위 체인 ID도 함께 수집 ──────────────────
async function resolveUnitWork(
  refType: string,
  refId: string
): Promise<{ unitWorkId: string | null; pathIds: string[] }> {
  switch (refType) {
    case "UNIT_WORK":
      return { unitWorkId: refId, pathIds: [refId] };

    case "SCREEN": {
      const scrn = await prisma.tbDsScreen.findUnique({ where: { scrn_id: refId } });
      if (!scrn?.unit_work_id) return { unitWorkId: null, pathIds: [] };
      return { unitWorkId: scrn.unit_work_id, pathIds: [refId, scrn.unit_work_id] };
    }

    case "AREA": {
      const area = await prisma.tbDsArea.findUnique({
        where: { area_id: refId },
        include: { screen: true },
      });
      if (!area?.screen?.unit_work_id) return { unitWorkId: null, pathIds: [] };
      return {
        unitWorkId: area.screen.unit_work_id,
        pathIds: [refId, area.screen.scrn_id, area.screen.unit_work_id],
      };
    }

    case "FUNCTION": {
      const func = await prisma.tbDsFunction.findUnique({
        where: { func_id: refId },
        include: { area: { include: { screen: true } } },
      });
      if (!func?.area?.screen?.unit_work_id) return { unitWorkId: null, pathIds: [] };
      return {
        unitWorkId: func.area.screen.unit_work_id,
        pathIds: [refId, func.area.area_id, func.area.screen.scrn_id, func.area.screen.unit_work_id],
      };
    }

    default:
      return { unitWorkId: null, pathIds: [] };
  }
}

// ── 트리에서 특정 ID의 노드를 찾는 재귀 함수 ────────────────────────────────
function findNode(node: TreeNode, id: string): TreeNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

// ── 노드의 모든 자손 ID를 Set에 추가 ────────────────────────────────────────
function collectAllIds(node: TreeNode, ids: Set<string>): void {
  ids.add(node.id);
  for (const child of node.children) {
    collectAllIds(child, ids);
  }
}
