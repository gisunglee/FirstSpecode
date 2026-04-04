/**
 * GET /api/projects/[id]/design/export — 설계 데이터 JSON 내보내기
 *
 * 역할:
 *   - 단위업무 → 화면 → 영역 → 기능 계층 전체를 JSON으로 출력
 *   - Claude 프로젝트에 붙여넣어 AI와 함께 수정한 뒤 bulk-import로 재등록하는 용도
 *
 * Query Params:
 *   unitWorkIds (optional) — 쉼표로 구분된 단위업무 UUID 목록
 *                             생략 시 프로젝트 전체 단위업무 내보내기
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  // 멤버십 확인 (조회는 모든 역할 가능)
  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  const url          = new URL(request.url);
  const unitWorkIdsParam = url.searchParams.get("unitWorkIds");

  // 쉼표 구분으로 여러 ID 처리
  const unitWorkIds = unitWorkIdsParam
    ? unitWorkIdsParam.split(",").map((id) => id.trim()).filter(Boolean)
    : undefined;

  try {
    const unitWorks = await prisma.tbDsUnitWork.findMany({
      where: {
        prjct_id: projectId,
        ...(unitWorkIds ? { unit_work_id: { in: unitWorkIds } } : {}),
      },
      include: {
        // req_id nullable → requirement 관계도 optional
        requirement: {
          select: { req_id: true, req_display_id: true, req_nm: true },
        },
        screens: {
          orderBy: { sort_ordr: "asc" },
          include: {
            areas: {
              orderBy: { sort_ordr: "asc" },
              include: {
                functions: {
                  orderBy: { sort_ordr: "asc" },
                },
              },
            },
          },
        },
      },
      orderBy: { sort_ordr: "asc" },
    });

    // DB 필드 → AI-친화적 JSON 키 변환
    const result = {
      unitWorks: unitWorks.map((uw) => ({
        systemId:            uw.unit_work_id,
        displayId:           uw.unit_work_display_id,
        name:                uw.unit_work_nm,
        description:         uw.unit_work_dc   ?? "",
        // requirementId — 있으면 포함 (수정 시 연결 유지용), 없으면 null
        requirementId:        uw.req_id ?? null,
        requirementDisplayId: uw.requirement?.req_display_id ?? null,
        requirementName:      uw.requirement?.req_nm         ?? null,
        screens: uw.screens.map((sc) => ({
          systemId:    sc.scrn_id,
          displayId:   sc.scrn_display_id,
          name:        sc.scrn_nm,
          description: sc.scrn_dc     ?? "",
          displayCode: sc.dsply_code  ?? "",
          screenType:  sc.scrn_ty_code,
          categoryL:   sc.ctgry_l_nm  ?? "",
          categoryM:   sc.ctgry_m_nm  ?? "",
          categoryS:   sc.ctgry_s_nm  ?? "",
          areas: sc.areas.map((ar) => ({
            systemId:    ar.area_id,
            displayId:   ar.area_display_id,
            name:        ar.area_nm,
            description: ar.area_dc     ?? "",
            areaType:    ar.area_ty_code,
            functions: ar.functions.map((fn) => ({
              systemId:    fn.func_id,
              displayId:   fn.func_display_id,
              name:        fn.func_nm,
              description: fn.func_dc    ?? "",
              priority:    fn.priort_code,
              complexity:  fn.cmplx_code,
            })),
          })),
        })),
      })),
    };

    return apiSuccess(result);
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/design/export] DB 오류:`, err);
    return apiError("DB_ERROR", "내보내기 중 오류가 발생했습니다.", 500);
  }
}
