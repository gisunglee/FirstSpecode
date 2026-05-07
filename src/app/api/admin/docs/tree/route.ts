/**
 * GET /api/admin/docs/tree — Docs 관리자용 전체 트리
 *
 * 역할:
 *   - 사용자 트리(/api/docs/tree)와 달리 모든 상태 + 모든 use_yn 포함
 *     (DRAFT / ARCHIVED / 숨김 use_yn=N 도 관리 화면에서는 보여야 함)
 *   - 빈 섹션도 노출 (사용자 트리에서는 자동 숨김)
 *   - 각 페이지의 page_sttus_code, badge_code, mdfcn_dt 도 함께
 *
 * 권한: SUPER_ADMIN 전용
 *
 * 응답:
 *   { data: { sections: [{ ...sect, pages: [{ ...page }] }] } }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";

export async function GET(request: NextRequest) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  try {
    const sections = await prisma.tbSysDocsSection.findMany({
      orderBy: [{ sort_ordr: "asc" }, { creat_dt: "asc" }],
      select: {
        sect_id:        true,
        sect_slug:      true,
        sect_nm:        true,
        sect_icon_code: true,
        sort_ordr:      true,
        use_yn:         true,
        creat_dt:       true,
        mdfcn_dt:       true,
        pages: {
          orderBy: [{ sort_ordr: "asc" }, { creat_dt: "asc" }],
          select: {
            page_id:         true,
            page_slug:       true,
            page_sj:         true,
            page_excerpt:    true,
            page_sttus_code: true,
            badge_code:      true,
            sort_ordr:       true,
            use_yn:          true,
            creat_dt:        true,
            mdfcn_dt:        true,
          },
        },
      },
    });

    const data = sections.map((s) => ({
      sectId:       s.sect_id,
      sectSlug:     s.sect_slug,
      sectNm:       s.sect_nm,
      sectIconCode: s.sect_icon_code,
      sortOrdr:     s.sort_ordr,
      useYn:        s.use_yn,
      createdAt:    s.creat_dt,
      updatedAt:    s.mdfcn_dt,
      pages: s.pages.map((p) => ({
        pageId:      p.page_id,
        pageSlug:    p.page_slug,
        pageSj:      p.page_sj,
        pageExcerpt: p.page_excerpt,
        statusCode:  p.page_sttus_code,
        badgeCode:   p.badge_code,
        sortOrdr:    p.sort_ordr,
        useYn:       p.use_yn,
        createdAt:   p.creat_dt,
        updatedAt:   p.mdfcn_dt,
      })),
    }));

    return apiSuccess({ sections: data });
  } catch (err) {
    console.error("[GET /api/admin/docs/tree]", err);
    return apiError("DB_ERROR", "문서 트리 조회에 실패했습니다.", 500);
  }
}
