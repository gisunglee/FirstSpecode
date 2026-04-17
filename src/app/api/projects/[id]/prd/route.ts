/**
 * GET /api/projects/[id]/prd — PRD 마크다운 생성
 *
 * Query:
 *   level  — FUNCTION | AREA | SCREEN | UNIT_WORK
 *   refId  — 해당 레벨 엔티티 ID
 *
 * 출력 원칙: 가공 없이 각 엔티티의 설명(dc) 필드를 계층 순서대로 이어 붙이기만 함
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

type PrdLevel = "FUNCTION" | "AREA" | "SCREEN" | "UNIT_WORK";

// dc 값을 블록 단위로 누적 (null/빈 값은 스킵)
function push(parts: string[], dc: string | null | undefined) {
  const trimmed = dc?.trim();
  if (trimmed) parts.push(trimmed);
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  const url   = new URL(request.url);
  const level = url.searchParams.get("level") as PrdLevel | null;
  const refId = url.searchParams.get("refId") ?? "";

  if (!level || !["FUNCTION", "AREA", "SCREEN", "UNIT_WORK"].includes(level)) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 level입니다.", 400);
  }
  if (!refId) {
    return apiError("VALIDATION_ERROR", "refId가 필요합니다.", 400);
  }

  try {
    const parts: string[] = [];
    let filename = "prd.md";

    if (level === "FUNCTION") {
      const fn = await prisma.tbDsFunction.findUnique({ where: { func_id: refId } });
      if (!fn || fn.prjct_id !== projectId) {
        return apiError("NOT_FOUND", "기능을 찾을 수 없습니다.", 404);
      }
      filename = `${fn.func_nm}.md`;
      push(parts, fn.func_dc);
    }

    else if (level === "AREA") {
      const area = await prisma.tbDsArea.findUnique({
        where:   { area_id: refId },
        include: { functions: { orderBy: { sort_ordr: "asc" } } },
      });
      if (!area || area.prjct_id !== projectId) {
        return apiError("NOT_FOUND", "영역을 찾을 수 없습니다.", 404);
      }
      filename = `${area.area_nm}.md`;
      push(parts, area.area_dc);
      for (const fn of area.functions) {
        push(parts, fn.func_dc);
      }
    }

    else if (level === "SCREEN") {
      const screen = await prisma.tbDsScreen.findUnique({
        where:   { scrn_id: refId },
        include: {
          areas: {
            orderBy: { sort_ordr: "asc" },
            include: { functions: { orderBy: { sort_ordr: "asc" } } },
          },
        },
      });
      if (!screen || screen.prjct_id !== projectId) {
        return apiError("NOT_FOUND", "화면을 찾을 수 없습니다.", 404);
      }
      filename = `${screen.scrn_nm}.md`;
      push(parts, screen.scrn_dc);
      for (const area of screen.areas) {
        push(parts, area.area_dc);
        for (const fn of area.functions) {
          push(parts, fn.func_dc);
        }
      }
    }

    else if (level === "UNIT_WORK") {
      const uw = await prisma.tbDsUnitWork.findUnique({
        where:   { unit_work_id: refId },
        include: {
          screens: {
            orderBy: { sort_ordr: "asc" },
            include: {
              areas: {
                orderBy: { sort_ordr: "asc" },
                include: { functions: { orderBy: { sort_ordr: "asc" } } },
              },
            },
          },
        },
      });
      if (!uw || uw.prjct_id !== projectId) {
        return apiError("NOT_FOUND", "단위업무를 찾을 수 없습니다.", 404);
      }
      filename = `${uw.unit_work_nm}.md`;
      push(parts, uw.unit_work_dc);
      for (const screen of uw.screens) {
        push(parts, screen.scrn_dc);
        for (const area of screen.areas) {
          push(parts, area.area_dc);
          for (const fn of area.functions) {
            push(parts, fn.func_dc);
          }
        }
      }
    }

    // 블록 사이 빈 줄 하나로 구분
    return apiSuccess({ markdown: parts.join("\n\n"), filename });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/prd] 오류:`, err);
    return apiError("DB_ERROR", "PRD 생성에 실패했습니다.", 500);
  }
}
