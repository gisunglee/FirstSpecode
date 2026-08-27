/**
 * GET  /api/projects/[id]/code-groups — 코드 그룹 목록 조회
 * POST /api/projects/[id]/code-groups — 코드 그룹 생성
 *
 * 역할:
 *   - 공통코드 그룹 목록 조회 (검색, 사용여부 필터)
 *   - 신규 그룹 등록
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "code.read");
  if (gate instanceof Response) return gate;

  const url = new URL(request.url);
  const search = url.searchParams.get("search") ?? "";
  const useYn = url.searchParams.get("useYn") ?? "";

  try {
    const groups = await prisma.tbCmCodeGroup.findMany({
      where: {
        prjct_id: projectId,
        ...(search
          ? {
              OR: [
                { grp_code: { contains: search, mode: "insensitive" } },
                { grp_code_nm: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(useYn ? { use_yn: useYn } : {}),
      },
      include: { codes: { select: { cm_code_id: true } } },
      orderBy: { grp_code: "asc" },
    });

    // DB 테이블 설계에서 이 그룹을 참조(ref_grp_code)하는 컬럼 수 — 그룹코드별 집계
    // "몇 군데서 실제로 쓰이고 있는지" 표시용. TbDsDbTableColumn 은 prjct_id가 없어
    // table 관계로 프로젝트 범위를 좁힘.
    const mappingCounts = await prisma.tbDsDbTableColumn.groupBy({
      by: ["ref_grp_code"],
      where: { ref_grp_code: { not: null }, table: { prjct_id: projectId } },
      _count: { ref_grp_code: true },
    });
    const mappingCountMap = new Map(
      mappingCounts.map((m) => [m.ref_grp_code as string, m._count.ref_grp_code])
    );

    return apiSuccess({
      items: groups.map((g) => ({
        grpCode: g.grp_code,
        grpCodeNm: g.grp_code_nm,
        grpCodeDc: g.grp_code_dc ?? "",
        useYn: g.use_yn,
        codeCount: g.codes.length,
        mappingCount: mappingCountMap.get(g.grp_code) ?? 0,
      })),
    });
  } catch (err) {
    console.error("[GET /api/code-groups]", err);
    return apiError("DB_ERROR", "코드 그룹 조회에 실패했습니다.", 500);
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  // 등록은 MEMBER 까지 개방 (content.create 와 동일 관례) — 수정/삭제는 별도 권한
  const gate = await requirePermission(request, projectId, "code.create");
  if (gate instanceof Response) return gate;

  let body: { grpCode?: string; grpCodeNm?: string; grpCodeDc?: string; useYn?: string };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const grpCode = body.grpCode?.trim();
  const grpCodeNm = body.grpCodeNm?.trim();
  if (!grpCode) return apiError("VALIDATION_ERROR", "그룹 코드를 입력해 주세요.", 400);
  if (!grpCodeNm) return apiError("VALIDATION_ERROR", "그룹 코드명을 입력해 주세요.", 400);

  // useYn: "Y" | "N" 만 허용. 미지정 시 기본 "Y" (기존 호환)
  if (body.useYn !== undefined && body.useYn !== "Y" && body.useYn !== "N") {
    return apiError("VALIDATION_ERROR", "useYn 은 'Y' 또는 'N' 만 허용됩니다.", 400);
  }
  const useYn = body.useYn === "N" ? "N" : "Y";

  try {
    // 같은 프로젝트 내 중복 체크
    const dupCode = await prisma.tbCmCodeGroup.findUnique({
      where: { prjct_id_grp_code: { prjct_id: projectId, grp_code: grpCode } },
    });
    if (dupCode) return apiError("DUPLICATE", "이미 존재하는 그룹 코드입니다.", 409);

    const dupNm = await prisma.tbCmCodeGroup.findUnique({
      where: { prjct_id_grp_code_nm: { prjct_id: projectId, grp_code_nm: grpCodeNm } },
    });
    if (dupNm) return apiError("DUPLICATE", "이미 존재하는 그룹명입니다.", 409);

    const created = await prisma.tbCmCodeGroup.create({
      data: {
        prjct_id: projectId,
        grp_code: grpCode,
        grp_code_nm: grpCodeNm,
        grp_code_dc: body.grpCodeDc?.trim() || null,
        use_yn: useYn,
        creat_mber_id: gate.mberId,
      },
    });

    return apiSuccess(
      { grpCode: created.grp_code, grpCodeNm: created.grp_code_nm },
      201
    );
  } catch (err) {
    console.error("[POST /api/code-groups]", err);
    return apiError("DB_ERROR", "코드 그룹 생성에 실패했습니다.", 500);
  }
}
