/**
 * PUT    /api/admin/docs/sections/[id] — 섹션 수정 (이름·슬러그·아이콘·정렬·노출)
 * DELETE /api/admin/docs/sections/[id] — 섹션 물리 삭제 (페이지가 있으면 차단)
 *
 * 권한: SUPER_ADMIN 전용
 *
 * 설계 메모:
 *   - PUT 은 부분 업데이트 — 전송된 필드만 갱신
 *   - DELETE 는 물리 삭제 (use_yn='N' 숨김은 PUT 으로 처리)
 *     · FK ON DELETE RESTRICT 가 페이지 잔존 시 차단하지만, 사용자에게
 *       친절한 에러를 주려고 사전 카운트로 가드
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";

type RouteParams = { params: Promise<{ id: string }> };

const SLUG_PATTERN = /^[a-z0-9-]{1,50}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── PUT: 부분 수정 ─────────────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 ID입니다.", 400);
  }

  let body: {
    sectSlug?:     string;
    sectNm?:       string;
    sectIconCode?: string | null;
    sortOrdr?:     number;
    useYn?:        string;
  };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  // 변경할 필드만 추려서 data 빌드
  const data: Record<string, unknown> = {
    mdfr_mber_id: gate.mberId,
    mdfcn_dt:     new Date(),
  };

  if (body.sectSlug !== undefined) {
    const slug = body.sectSlug.trim().toLowerCase();
    if (!SLUG_PATTERN.test(slug)) {
      return apiError("VALIDATION_ERROR", "슬러그는 영문 소문자/숫자/하이픈으로 1~50자입니다.", 400);
    }
    // 같은 slug 가 다른 활성 섹션에 있는지 — 자기 자신은 제외
    const dup = await prisma.tbSysDocsSection.findFirst({
      where: { sect_slug: slug, use_yn: "Y", NOT: { sect_id: id } },
      select: { sect_id: true },
    });
    if (dup) return apiError("DUPLICATE_SLUG", "이미 사용 중인 슬러그입니다.", 409);
    data.sect_slug = slug;
  }

  if (body.sectNm !== undefined) {
    const nm = body.sectNm.trim();
    if (!nm)              return apiError("VALIDATION_ERROR", "섹션명을 입력해 주세요.", 400);
    if (nm.length > 200)  return apiError("VALIDATION_ERROR", "섹션명은 200자 이하입니다.", 400);
    data.sect_nm = nm;
  }

  if (body.sectIconCode !== undefined) {
    data.sect_icon_code = body.sectIconCode || null;
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
    const updated = await prisma.tbSysDocsSection.update({
      where: { sect_id: id },
      data,
    });
    return apiSuccess({ sectId: updated.sect_id });
  } catch (err: unknown) {
    // Prisma P2025 = Record not found
    const code = (err as { code?: string }).code;
    if (code === "P2025") return apiError("NOT_FOUND", "섹션을 찾을 수 없습니다.", 404);
    console.error("[PUT /api/admin/docs/sections/[id]]", err);
    return apiError("DB_ERROR", "섹션 수정에 실패했습니다.", 500);
  }
}

// ── DELETE: 물리 삭제 (페이지가 있으면 차단) ─────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return apiError("VALIDATION_ERROR", "유효하지 않은 ID입니다.", 400);
  }

  try {
    // 페이지 존재 여부 사전 체크 — 친절한 에러 + use_yn='N' 도 카운트에 포함
    // (use_yn='N' 페이지가 남은 채로 섹션 물리 삭제하면 FK 위반)
    const pageCount = await prisma.tbSysDocsPage.count({ where: { sect_id: id } });
    if (pageCount > 0) {
      return apiError(
        "SECTION_HAS_PAGES",
        `섹션에 페이지 ${pageCount}건이 남아있어 삭제할 수 없습니다. 먼저 페이지를 삭제하거나 다른 섹션으로 이동해 주세요.`,
        409
      );
    }

    await prisma.tbSysDocsSection.delete({ where: { sect_id: id } });
    return apiSuccess({ sectId: id });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "P2025") return apiError("NOT_FOUND", "섹션을 찾을 수 없습니다.", 404);
    console.error("[DELETE /api/admin/docs/sections/[id]]", err);
    return apiError("DB_ERROR", "섹션 삭제에 실패했습니다.", 500);
  }
}
