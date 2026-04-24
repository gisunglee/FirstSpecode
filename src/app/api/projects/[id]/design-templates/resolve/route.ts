/**
 * GET /api/projects/[id]/design-templates/resolve?refType=… — 활성 양식 1건 해결
 *
 * 역할:
 *   - 5계층 상세 페이지(요구사항/단위업무/화면/영역/기능)의 "예시"·"템플릿 삽입"
 *     버튼이 렌더링 시점에 호출. 현재 프로젝트에서 **실제로 사용할 양식 1건**을 반환.
 *
 * 우선순위 (findFirst + orderBy):
 *   1. 프로젝트 전용 양식 (prjct_id = projectId) 이 공통보다 우선
 *   2. sort_ordr 오름차순 (운영자가 순서로 기본값 지정 가능)
 *   3. creat_dt 오름차순 (동률일 때 먼저 만든 것 우선)
 *
 * 해당 계층 양식이 전혀 없으면 { data: null } 반환 →
 *   상세 페이지는 "예시"/"템플릿 삽입" 버튼을 disabled 로 처리.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { DESIGN_REF_TYPES } from "@/lib/designTemplate";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const url     = new URL(request.url);
  const refType = url.searchParams.get("refType") ?? "";

  if (!(DESIGN_REF_TYPES as readonly string[]).includes(refType)) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 대상 계층입니다.", 400);
  }

  try {
    const found = await prisma.tbAiDesignTemplate.findFirst({
      where: {
        ref_ty_code: refType,
        use_yn:      "Y",
        OR: [{ prjct_id: projectId }, { prjct_id: null }],
      },
      orderBy: [
        // 프로젝트 전용(NOT NULL) 을 공통(NULL)보다 우선
        { prjct_id: { sort: "desc", nulls: "last" } },
        { sort_ordr: "asc" },
        { creat_dt:  "asc" },
      ],
    });

    if (!found) {
      return apiSuccess(null);
    }

    return apiSuccess({
      dsgnTmplId:  found.dsgn_tmpl_id,
      isSystem:    found.prjct_id === null,
      refTyCode:   found.ref_ty_code,
      tmplNm:      found.tmpl_nm,
      exampleCn:   found.example_cn  ?? "",
      templateCn:  found.template_cn ?? "",
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/design-templates/resolve] DB 오류:`, err);
    return apiError("DB_ERROR", "설계 양식 조회에 실패했습니다.", 500);
  }
}
