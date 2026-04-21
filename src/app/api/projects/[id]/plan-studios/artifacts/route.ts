/**
 * GET /api/projects/[id]/plan-studios/artifacts — 프로젝트 전체 산출물 검색 (FID-PS-12)
 *
 * 역할:
 *   - 기획보드 컨텍스트 추가 팝업용
 *   - 현재 프로젝트의 모든 기획실의 모든 산출물 검색
 *   - q(키워드), excludeArtfId(자기 제외) 파라미터 지원
 *   - 라벨: 'PB-00001 > 시스템 정보 구조도' 형식
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const excludeArtfId = url.searchParams.get("excludeArtfId") ?? "";

  try {
    // 프로젝트 내 모든 기획실의 산출물 검색
    const artfs = await prisma.tbDsPlanStudioArtf.findMany({
      where: {
        planStudio: { prjct_id: projectId },
        ...(excludeArtfId ? { artf_id: { not: excludeArtfId } } : {}),
        ...(q
          ? {
              OR: [
                { artf_nm: { contains: q, mode: "insensitive" } },
                { planStudio: { plan_studio_display_id: { contains: q, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      include: { planStudio: { select: { plan_studio_display_id: true, plan_studio_nm: true } } },
      orderBy: { creat_dt: "desc" },
      take: 100,
    });

    return apiSuccess({
      items: artfs.map((a) => ({
        artfId: a.artf_id,
        artfNm: a.artf_nm,
        artfDivCode: a.artf_div_code,
        planStudioDisplayId: a.planStudio.plan_studio_display_id,
        planStudioNm: a.planStudio.plan_studio_nm,
        // 라벨: 'PB-00001 > 시스템 정보 구조도'
        refLabel: `${a.planStudio.plan_studio_display_id} > ${a.artf_nm}`,
      })),
    });
  } catch (err) {
    console.error("[GET /api/plan-studios/artifacts]", err);
    return apiError("DB_ERROR", "기획보드 검색에 실패했습니다.", 500);
  }
}
