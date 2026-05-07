/**
 * POST /api/admin/docs/pages — 페이지 신규 생성 (DRAFT 셸)
 *
 * 역할:
 *   - 트리에서 [+ 페이지] 클릭 시 호출
 *   - 본문(page_cn)은 비워둔 채 DRAFT 상태로 빈 페이지 생성
 *   - 생성 직후 admin 화면이 page_id 를 받아 에디터(/admin/docs/[pageId])로 이동
 *
 * 권한: SUPER_ADMIN 전용
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";

const SLUG_PATTERN = /^[a-z0-9-]{1,50}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  let body: {
    sectId?:    string;
    pageSlug?:  string;
    pageSj?:    string;
    sortOrdr?:  number;
  };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const sectId = body.sectId?.trim() ?? "";
  const slug   = body.pageSlug?.trim().toLowerCase() ?? "";
  const title  = body.pageSj?.trim() ?? "";

  if (!UUID_PATTERN.test(sectId))   return apiError("VALIDATION_ERROR", "섹션 ID가 유효하지 않습니다.", 400);
  if (!SLUG_PATTERN.test(slug))     return apiError("VALIDATION_ERROR", "슬러그는 영문 소문자/숫자/하이픈으로 1~50자입니다.", 400);
  if (!title)                       return apiError("VALIDATION_ERROR", "페이지 제목을 입력해 주세요.", 400);
  if (title.length > 200)           return apiError("VALIDATION_ERROR", "페이지 제목은 200자 이하입니다.", 400);

  try {
    // 섹션 존재 확인 — FK 가 잡지만 친절 에러 우선
    const sect = await prisma.tbSysDocsSection.findUnique({
      where:  { sect_id: sectId },
      select: { sect_id: true },
    });
    if (!sect) return apiError("NOT_FOUND", "섹션을 찾을 수 없습니다.", 404);

    // 같은 섹션 안 활성 페이지 중 동일 slug 중복 체크
    const dup = await prisma.tbSysDocsPage.findFirst({
      where: { sect_id: sectId, page_slug: slug, use_yn: "Y" },
      select: { page_id: true },
    });
    if (dup) return apiError("DUPLICATE_SLUG", "이미 사용 중인 슬러그입니다.", 409);

    // sort_ordr 자동 — 같은 섹션 마지막 + 10
    let sortOrdr = body.sortOrdr;
    if (typeof sortOrdr !== "number") {
      const last = await prisma.tbSysDocsPage.findFirst({
        where:   { sect_id: sectId },
        orderBy: { sort_ordr: "desc" },
        select:  { sort_ordr: true },
      });
      sortOrdr = (last?.sort_ordr ?? 0) + 10;
    }

    const created = await prisma.tbSysDocsPage.create({
      data: {
        sect_id:         sectId,
        page_slug:       slug,
        page_sj:         title,
        page_sttus_code: "DRAFT",
        sort_ordr:       sortOrdr,
        use_yn:          "Y",
        creat_mber_id:   gate.mberId,
      },
    });

    return apiSuccess({
      pageId:   created.page_id,
      pageSlug: created.page_slug,
      pageSj:   created.page_sj,
    }, 201);
  } catch (err) {
    console.error("[POST /api/admin/docs/pages]", err);
    return apiError("DB_ERROR", "페이지 생성에 실패했습니다.", 500);
  }
}
