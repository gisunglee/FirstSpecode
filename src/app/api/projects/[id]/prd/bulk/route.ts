/**
 * POST /api/projects/[id]/prd/bulk — 다중 단위업무 PRD 마크다운 일괄 생성
 *
 * Body:
 *   unitWorkIds     — 대상 단위업무 ID 배열 (빈 배열 = 프로젝트 전체)
 *   includeScreens  — 화면 포함 여부 (기본 true)
 *   includeAreas    — 영역 포함 여부 (기본 true)
 *   includeFunctions— 기능 포함 여부 (기본 true)
 *   contentMode     — "title_only" | "with_content"
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

type ContentMode = "title_only" | "with_content";

type RequestBody = {
  unitWorkIds?:      string[];
  includeScreens?:   boolean;
  includeAreas?:     boolean;
  includeFunctions?: boolean;
  contentMode?:      ContentMode;
};

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const {
    unitWorkIds      = [],
    includeScreens   = true,
    includeAreas     = true,
    includeFunctions = true,
    contentMode      = "with_content",
  } = body;

  try {
    // 대상 단위업무 조회 (빈 배열 = 프로젝트 전체)
    const unitWorks = await prisma.tbDsUnitWork.findMany({
      where: {
        prjct_id: projectId,
        ...(unitWorkIds.length > 0 ? { unit_work_id: { in: unitWorkIds } } : {}),
      },
      orderBy: { sort_ordr: "asc" },
      include: includeScreens ? {
        screens: {
          orderBy: { sort_ordr: "asc" },
          include: includeAreas ? {
            areas: {
              orderBy: { sort_ordr: "asc" },
              include: includeFunctions ? {
                functions: { orderBy: { sort_ordr: "asc" } },
              } : undefined,
            },
          } : undefined,
        },
      } : undefined,
    });

    if (unitWorks.length === 0) {
      return apiError("NOT_FOUND", "대상 단위업무가 없습니다.", 404);
    }

    const lines: string[] = [];

    for (const uw of unitWorks) {
      lines.push(`# ${uw.unit_work_display_id} ${uw.unit_work_nm}`);
      if (contentMode === "with_content" && uw.unit_work_dc?.trim()) {
        lines.push("");
        lines.push(uw.unit_work_dc.trim());
      }

      if (!includeScreens) continue;
      const screens = (uw as any).screens ?? [];

      for (const screen of screens) {
        lines.push("");
        lines.push(`## ${screen.scrn_display_id} ${screen.scrn_nm}`);
        if (contentMode === "with_content" && screen.scrn_dc?.trim()) {
          lines.push("");
          lines.push(screen.scrn_dc.trim());
        }

        if (!includeAreas) continue;
        const areas = (screen as any).areas ?? [];

        for (const area of areas) {
          lines.push("");
          lines.push(`### ${area.area_display_id} ${area.area_nm}`);
          if (contentMode === "with_content" && area.area_dc?.trim()) {
            lines.push("");
            lines.push(area.area_dc.trim());
          }

          if (!includeFunctions) continue;
          const functions = (area as any).functions ?? [];

          for (const fn of functions) {
            lines.push("");
            lines.push(`#### ${fn.func_display_id} ${fn.func_nm}`);
            if (contentMode === "with_content" && fn.func_dc?.trim()) {
              lines.push("");
              lines.push(fn.func_dc.trim());
            }
          }
        }
      }

      lines.push("");
    }

    const markdown = lines.join("\n").trim();
    const filename = unitWorks.length === 1
      ? `PRD_${unitWorks[0].unit_work_nm}.md`
      : `PRD_설계_${unitWorks.length}건.md`;

    return apiSuccess({ markdown, filename });
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/prd/bulk] 오류:`, err);
    return apiError("DB_ERROR", "PRD 생성에 실패했습니다.", 500);
  }
}
