/**
 * GET    /api/admin/docs/pages/[id] — 페이지 단건 (편집기용, 본문 포함)
 * PUT    /api/admin/docs/pages/[id] — 페이지 수정 (메타 + 본문 모두 가능)
 * DELETE /api/admin/docs/pages/[id] — 페이지 물리 삭제
 *
 * 권한: SUPER_ADMIN 전용
 *
 * 설계 메모:
 *   - PUT 은 부분 업데이트. 본문(contentMd) 미전송이면 본문은 그대로 유지.
 *     → 트리 화면에서 메타만 수정할 때(이름/슬러그/상태) 본문 누락 보호.
 *   - sectId 변경 = 다른 섹션으로 이동. 이때 새 섹션 안에서 슬러그 중복 검사 다시.
 *   - DELETE 는 물리 삭제. 첨부파일은 use_yn='N' 으로 정리(고아 방지).
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";

type RouteParams = { params: Promise<{ id: string }> };

const SLUG_PATTERN   = /^[a-z0-9-]{1,50}$/;
const UUID_PATTERN   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_VALUES  = new Set(["DRAFT", "PUBLISHED", "ARCHIVED"]);
const BADGE_VALUES   = new Set(["NEW", "BETA", "DEPRECATED"]);

// ── GET: 편집기용 단건 ───────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 ID입니다.", 400);
  }

  try {
    const row = await prisma.tbSysDocsPage.findUnique({
      where: { page_id: id },
      select: {
        page_id:         true,
        sect_id:         true,
        page_slug:       true,
        page_sj:         true,
        page_excerpt:    true,
        page_cn:         true,
        page_sttus_code: true,
        badge_code:      true,
        sort_ordr:       true,
        use_yn:          true,
        creat_dt:        true,
        mdfcn_dt:        true,
        section: {
          select: { sect_slug: true, sect_nm: true },
        },
      },
    });

    if (!row) return apiError("NOT_FOUND", "페이지를 찾을 수 없습니다.", 404);

    return apiSuccess({
      pageId:      row.page_id,
      sectId:      row.sect_id,
      pageSlug:    row.page_slug,
      pageSj:      row.page_sj,
      pageExcerpt: row.page_excerpt,
      contentMd:   row.page_cn ?? "",
      statusCode:  row.page_sttus_code,
      badgeCode:   row.badge_code,
      sortOrdr:    row.sort_ordr,
      useYn:       row.use_yn,
      sectSlug:    row.section.sect_slug,
      sectNm:      row.section.sect_nm,
      createdAt:   row.creat_dt,
      updatedAt:   row.mdfcn_dt,
    });
  } catch (err) {
    console.error("[GET /api/admin/docs/pages/[id]]", err);
    return apiError("DB_ERROR", "페이지 조회에 실패했습니다.", 500);
  }
}

// ── PUT: 부분 수정 ─────────────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 ID입니다.", 400);
  }

  let body: {
    sectId?:      string;
    pageSlug?:    string;
    pageSj?:      string;
    pageExcerpt?: string | null;
    contentMd?:   string;
    statusCode?:  string;
    badgeCode?:   string | null;
    sortOrdr?:    number;
    useYn?:       string;
  };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  // 현재 페이지 조회 — 슬러그/섹션 변경 시 중복 검사 기준
  const current = await prisma.tbSysDocsPage.findUnique({
    where:  { page_id: id },
    select: { sect_id: true, page_slug: true },
  });
  if (!current) return apiError("NOT_FOUND", "페이지를 찾을 수 없습니다.", 404);

  // 이동·슬러그 변경 시 검증할 최종 (sectId, slug) 결정
  const nextSectId = body.sectId?.trim() ?? current.sect_id;
  const nextSlug   = (body.pageSlug?.trim().toLowerCase()) ?? current.page_slug;

  const data: Record<string, unknown> = {
    mdfr_mber_id: gate.mberId,
    mdfcn_dt:     new Date(),
  };

  if (body.sectId !== undefined) {
    if (!UUID_PATTERN.test(nextSectId)) {
      return apiError("VALIDATION_ERROR", "섹션 ID가 유효하지 않습니다.", 400);
    }
    // 섹션 존재 확인
    const sect = await prisma.tbSysDocsSection.findUnique({
      where:  { sect_id: nextSectId },
      select: { sect_id: true },
    });
    if (!sect) return apiError("NOT_FOUND", "이동할 섹션을 찾을 수 없습니다.", 404);
    data.sect_id = nextSectId;
  }

  if (body.pageSlug !== undefined) {
    if (!SLUG_PATTERN.test(nextSlug)) {
      return apiError("VALIDATION_ERROR", "슬러그는 영문 소문자/숫자/하이픈으로 1~50자입니다.", 400);
    }
    data.page_slug = nextSlug;
  }

  // 슬러그/섹션이 바뀌면 새 (sectId, slug) 조합에서 다른 활성 페이지가 없는지 확인
  const slugChanged = body.pageSlug !== undefined && nextSlug !== current.page_slug;
  const sectChanged = body.sectId   !== undefined && nextSectId !== current.sect_id;
  if (slugChanged || sectChanged) {
    const dup = await prisma.tbSysDocsPage.findFirst({
      where: {
        sect_id:   nextSectId,
        page_slug: nextSlug,
        use_yn:    "Y",
        NOT:       { page_id: id },
      },
      select: { page_id: true },
    });
    if (dup) return apiError("DUPLICATE_SLUG", "해당 섹션에 이미 같은 슬러그가 있습니다.", 409);
  }

  if (body.pageSj !== undefined) {
    const t = body.pageSj.trim();
    if (!t)             return apiError("VALIDATION_ERROR", "페이지 제목을 입력해 주세요.", 400);
    if (t.length > 200) return apiError("VALIDATION_ERROR", "페이지 제목은 200자 이하입니다.", 400);
    data.page_sj = t;
  }

  if (body.pageExcerpt !== undefined) {
    const e = body.pageExcerpt;
    if (e !== null && typeof e === "string" && e.length > 500) {
      return apiError("VALIDATION_ERROR", "요약은 500자 이하입니다.", 400);
    }
    data.page_excerpt = e === null || e === "" ? null : e;
  }

  // 본문은 명시적으로 전송된 경우에만 갱신 (트리 화면에서 메타만 수정 시 본문 보호)
  if (body.contentMd !== undefined) {
    data.page_cn = body.contentMd;
  }

  if (body.statusCode !== undefined) {
    if (!STATUS_VALUES.has(body.statusCode)) {
      return apiError("VALIDATION_ERROR", "상태 값은 DRAFT/PUBLISHED/ARCHIVED 중 하나입니다.", 400);
    }
    data.page_sttus_code = body.statusCode;
  }

  if (body.badgeCode !== undefined) {
    if (body.badgeCode !== null && body.badgeCode !== "" && !BADGE_VALUES.has(body.badgeCode)) {
      return apiError("VALIDATION_ERROR", "배지는 NEW/BETA/DEPRECATED 중 하나입니다.", 400);
    }
    data.badge_code = body.badgeCode || null;
  }

  if (body.sortOrdr !== undefined) {
    if (!Number.isInteger(body.sortOrdr)) {
      return apiError("VALIDATION_ERROR", "정렬값은 정수여야 합니다.", 400);
    }
    data.sort_ordr = body.sortOrdr;
  }

  if (body.useYn !== undefined) {
    if (body.useYn !== "Y" && body.useYn !== "N") {
      return apiError("VALIDATION_ERROR", "노출 값은 Y 또는 N 입니다.", 400);
    }
    data.use_yn = body.useYn;
  }

  try {
    await prisma.tbSysDocsPage.update({
      where: { page_id: id },
      data,
    });
    return apiSuccess({ pageId: id });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "P2025") return apiError("NOT_FOUND", "페이지를 찾을 수 없습니다.", 404);
    console.error("[PUT /api/admin/docs/pages/[id]]", err);
    return apiError("DB_ERROR", "페이지 수정에 실패했습니다.", 500);
  }
}

// ── DELETE: 물리 삭제 + 첨부 정리 ──────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 ID입니다.", 400);
  }

  try {
    // 트랜잭션: 페이지 삭제 + 첨부파일 use_yn='N' 처리
    // 디스크 물리 파일은 별도 cleanup 배치가 처리 (즉시 삭제 시 동시성 위험)
    await prisma.$transaction(async (tx) => {
      await tx.tbSysAttachFile.updateMany({
        where: { ref_tbl_nm: "tb_sys_docs_page", ref_id: id, use_yn: "Y" },
        data:  { use_yn: "N", mdfr_mber_id: gate.mberId, mdfcn_dt: new Date() },
      });
      await tx.tbSysDocsPage.delete({ where: { page_id: id } });
    });

    return apiSuccess({ pageId: id });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "P2025") return apiError("NOT_FOUND", "페이지를 찾을 수 없습니다.", 404);
    console.error("[DELETE /api/admin/docs/pages/[id]]", err);
    return apiError("DB_ERROR", "페이지 삭제에 실패했습니다.", 500);
  }
}
