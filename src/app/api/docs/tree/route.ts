/**
 * GET /api/docs/tree — Docs Hub 트리 (사용자 뷰어용)
 *
 * 역할:
 *   - 좌측 트리에 표시할 섹션 + 페이지 목록을 한 번에 반환
 *   - 사용자에게는 PUBLISHED 상태 + use_yn='Y' 만 노출
 *   - 정렬: 섹션 sort_ordr → 페이지 sort_ordr
 *
 * 인증:
 *   - 로그인 사용자만 (requireAuth) — Docs visibility=MEMBER 정책
 *   - 추후 PUBLIC 옵션 도입 시 visibility 컬럼으로 분기 예정
 *
 * 응답 구조:
 *   { data: { sections: Array<{
 *       sectId, sectSlug, sectNm, sectIconCode, sortOrdr,
 *       pages: Array<{ pageId, pageSlug, pageSj, pageExcerpt, badgeCode, sortOrdr }>
 *   }> } }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess } from "@/lib/apiResponse";
import { requireAuth } from "@/lib/requireAuth";

// 사용자 뷰어가 받는 페이지 형태 — DRAFT/ARCHIVED 는 응답에서 제외
type TreePage = {
  pageId:      string;
  pageSlug:    string;
  pageSj:      string;
  pageExcerpt: string | null;
  badgeCode:   string | null;
  sortOrdr:    number;
};

type TreeSection = {
  sectId:       string;
  sectSlug:     string;
  sectNm:       string;
  sectIconCode: string | null;
  sortOrdr:     number;
  pages:        TreePage[];
};

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  // 섹션 + 발행된 페이지를 한 쿼리에 묶어 가져온다
  // (분리 쿼리 후 자바스크립트에서 결합도 가능하지만, Prisma include 가 더 명시적)
  const sections = await prisma.tbSysDocsSection.findMany({
    where: { use_yn: "Y" },
    orderBy: [{ sort_ordr: "asc" }, { creat_dt: "asc" }],
    select: {
      sect_id:        true,
      sect_slug:      true,
      sect_nm:        true,
      sect_icon_code: true,
      sort_ordr:      true,
      pages: {
        // 사용자에게는 발행된 것만 — DRAFT/ARCHIVED 는 관리자 화면에서만 보임
        where: {
          use_yn:          "Y",
          page_sttus_code: "PUBLISHED",
        },
        orderBy: [{ sort_ordr: "asc" }, { creat_dt: "asc" }],
        select: {
          page_id:      true,
          page_slug:    true,
          page_sj:      true,
          page_excerpt: true,
          badge_code:   true,
          sort_ordr:    true,
        },
      },
    },
  });

  // 페이지 0건인 빈 섹션은 사용자 트리에서 자동 숨김.
  // (관리자는 자기 화면에서 빈 섹션도 보여야 하므로 이 필터는 사용자 API 에만 적용)
  const data: TreeSection[] = sections
    .filter((s) => s.pages.length > 0)
    .map((s) => ({
      sectId:       s.sect_id,
      sectSlug:     s.sect_slug,
      sectNm:       s.sect_nm,
      sectIconCode: s.sect_icon_code,
      sortOrdr:     s.sort_ordr,
      pages: s.pages.map((p) => ({
        pageId:      p.page_id,
        pageSlug:    p.page_slug,
        pageSj:      p.page_sj,
        pageExcerpt: p.page_excerpt,
        badgeCode:   p.badge_code,
        sortOrdr:    p.sort_ordr,
      })),
    }));

  return apiSuccess({ sections: data });
}
