/**
 * GET /api/docs/[section]/[page] — 페이지 본문 단건 조회 (사용자 뷰어용)
 *
 * 역할:
 *   - URL slug 두 단계로 페이지를 찾아 본문(Markdown) 반환
 *   - 같은 섹션 안의 이전/다음 페이지 정보도 함께 (페이저용)
 *   - 사용자는 PUBLISHED 만 조회 가능 — DRAFT/ARCHIVED 는 404 처리
 *
 * 인증:
 *   - 로그인 사용자만 (requireAuth)
 *
 * URL:
 *   /api/docs/getting-started/welcome → "시작하기 > 환영합니다"
 *
 * 응답 구조:
 *   { data: {
 *       page:    { pageId, pageSj, pageExcerpt, contentMd, badgeCode, mdfcnDt },
 *       section: { sectSlug, sectNm },
 *       prev:    { sectSlug, pageSlug, pageSj } | null,
 *       next:    { sectSlug, pageSlug, pageSj } | null,
 *   } }
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireAuth } from "@/lib/requireAuth";

// Next.js 16 — 동적 세그먼트 params 는 Promise. await 누락 시 undefined.
type RouteParams = { params: Promise<{ section: string; page: string }> };

// slug 안전성 — 영문 소문자/숫자/하이픈만 허용 (50자 이내)
// 비정상 입력은 404 가 아니라 400 으로 빠르게 거부 (DB 쿼리 방어)
const SLUG_PATTERN = /^[a-z0-9-]{1,50}$/;

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { section, page } = await params;

  if (!SLUG_PATTERN.test(section) || !SLUG_PATTERN.test(page)) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 경로입니다.", 400);
  }

  // 섹션 → 페이지 순으로 조회.
  // 한 번에 join 으로 가져오는 것도 가능하나, 404 분기를 명확히 하려고 분리.
  const sect = await prisma.tbSysDocsSection.findFirst({
    where: { sect_slug: section, use_yn: "Y" },
    select: { sect_id: true, sect_slug: true, sect_nm: true },
  });

  if (!sect) {
    return apiError("NOT_FOUND", "문서를 찾을 수 없습니다.", 404);
  }

  // 페이지는 PUBLISHED + use_yn='Y' 만 — DRAFT/ARCHIVED 는 사용자에게 노출 금지
  const pageRow = await prisma.tbSysDocsPage.findFirst({
    where: {
      sect_id:         sect.sect_id,
      page_slug:       page,
      use_yn:          "Y",
      page_sttus_code: "PUBLISHED",
    },
    select: {
      page_id:      true,
      page_sj:      true,
      page_excerpt: true,
      page_cn:      true,
      badge_code:   true,
      sort_ordr:    true,
      mdfcn_dt:     true,
      creat_dt:     true,
    },
  });

  if (!pageRow) {
    return apiError("NOT_FOUND", "문서를 찾을 수 없습니다.", 404);
  }

  // 이전/다음 페이지 — 같은 섹션의 sort_ordr 기준
  // (다른 섹션으로의 chain 진행은 1차 구현에서 제외 — 단순함 우선)
  const siblings = await prisma.tbSysDocsPage.findMany({
    where: {
      sect_id:         sect.sect_id,
      use_yn:          "Y",
      page_sttus_code: "PUBLISHED",
    },
    orderBy: [{ sort_ordr: "asc" }, { creat_dt: "asc" }],
    select: { page_slug: true, page_sj: true, sort_ordr: true },
  });

  const idx = siblings.findIndex((s) => s.page_slug === page);
  const prev = idx > 0
    ? { sectSlug: sect.sect_slug, pageSlug: siblings[idx - 1]!.page_slug, pageSj: siblings[idx - 1]!.page_sj }
    : null;
  const next = idx >= 0 && idx < siblings.length - 1
    ? { sectSlug: sect.sect_slug, pageSlug: siblings[idx + 1]!.page_slug, pageSj: siblings[idx + 1]!.page_sj }
    : null;

  // 별첨 다운로드 — 페이지 하단 표시용. INLINE 은 본문 markdown 에 이미
  // 포함돼 있으므로 별도 조회 불필요.
  const attachRows = await prisma.tbSysAttachFile.findMany({
    where: {
      ref_tbl_nm:      "tb_sys_docs_page",
      ref_id:          pageRow.page_id,
      use_yn:          "Y",
      attach_div_code: "ATTACH",
    },
    orderBy: [{ sort_ordr: "asc" }, { creat_dt: "asc" }],
    select: {
      attach_id:     true,
      orgnl_file_nm: true,
      file_sz:       true,
      file_extsn_nm: true,
    },
  });

  const attachments = attachRows.map((a) => ({
    fileId:   a.attach_id,
    fileName: a.orgnl_file_nm,
    // BigInt → Number — 50MB 정책상 Number 안전 구간
    fileSize: Number(a.file_sz),
    extension: a.file_extsn_nm,
    downloadUrl: `/api/docs/files/${a.attach_id}/view?download=1`,
  }));

  return apiSuccess({
    page: {
      pageId:      pageRow.page_id,
      pageSj:      pageRow.page_sj,
      pageExcerpt: pageRow.page_excerpt,
      contentMd:   pageRow.page_cn ?? "",
      badgeCode:   pageRow.badge_code,
      // 마지막 수정 — 미수정이면 작성일 사용 (사용자에게는 "최근 갱신" 의미가 더 중요)
      lastUpdated: pageRow.mdfcn_dt ?? pageRow.creat_dt,
    },
    section: {
      sectSlug: sect.sect_slug,
      sectNm:   sect.sect_nm,
    },
    attachments,
    prev,
    next,
  });
}
