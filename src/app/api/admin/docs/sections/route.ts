/**
 * POST /api/admin/docs/sections — 섹션 신규 생성
 *
 * 역할:
 *   - 트리 1단계 항목(섹션) 추가
 *   - sort_ordr 미지정 시 마지막 위치(현재 최대값 + 10) 자동 부여
 *   - sect_slug 는 활성(use_yn='Y') 범위에서 전역 유니크 — partial unique idx 가 보장
 *
 * 권한: SUPER_ADMIN
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";

// 영문 소문자 + 숫자 + 하이픈만, 1~50자
const SLUG_PATTERN = /^[a-z0-9-]{1,50}$/;

export async function POST(request: NextRequest) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  let body: { sectSlug?: string; sectNm?: string; sectIconCode?: string | null; sortOrdr?: number };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const slug = body.sectSlug?.trim().toLowerCase() ?? "";
  const name = body.sectNm?.trim() ?? "";

  if (!SLUG_PATTERN.test(slug)) {
    return apiError("VALIDATION_ERROR", "슬러그는 영문 소문자/숫자/하이픈으로 1~50자입니다.", 400);
  }
  if (!name) return apiError("VALIDATION_ERROR", "섹션명을 입력해 주세요.", 400);
  if (name.length > 200) return apiError("VALIDATION_ERROR", "섹션명은 200자 이하입니다.", 400);

  try {
    // 활성 상태에서 동일 slug 가 이미 있는지 사전 체크 — partial unique 가 잡지만
    // 사용자에게 더 친절한 에러 메시지를 위해 미리 확인
    const dup = await prisma.tbSysDocsSection.findFirst({
      where: { sect_slug: slug, use_yn: "Y" },
      select: { sect_id: true },
    });
    if (dup) {
      return apiError("DUPLICATE_SLUG", "이미 사용 중인 슬러그입니다.", 409);
    }

    // sort_ordr 자동 부여 — 마지막 + 10 (10단위 간격으로 끼워넣기 여유 확보)
    let sortOrdr = body.sortOrdr;
    if (typeof sortOrdr !== "number") {
      const last = await prisma.tbSysDocsSection.findFirst({
        orderBy: { sort_ordr: "desc" },
        select:  { sort_ordr: true },
      });
      sortOrdr = (last?.sort_ordr ?? 0) + 10;
    }

    const created = await prisma.tbSysDocsSection.create({
      data: {
        sect_slug:      slug,
        sect_nm:        name,
        sect_icon_code: body.sectIconCode ?? null,
        sort_ordr:      sortOrdr,
        use_yn:         "Y",
        creat_mber_id:  gate.mberId,
      },
    });

    return apiSuccess({
      sectId:   created.sect_id,
      sectSlug: created.sect_slug,
      sectNm:   created.sect_nm,
    }, 201);
  } catch (err) {
    console.error("[POST /api/admin/docs/sections]", err);
    return apiError("DB_ERROR", "섹션 생성에 실패했습니다.", 500);
  }
}
