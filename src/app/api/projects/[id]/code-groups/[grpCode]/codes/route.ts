/**
 * GET  /api/projects/[id]/code-groups/[grpCode]/codes — 코드 목록 조회
 * POST /api/projects/[id]/code-groups/[grpCode]/codes — 코드 생성
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; grpCode: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, grpCode } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const codes = await prisma.tbCmCode.findMany({
      where: { grp_code: grpCode },
      orderBy: [{ sort_ordr: "asc" }, { creat_dt: "asc" }],
    });

    return apiSuccess({
      items: codes.map((c) => ({
        cmCode: c.cm_code,
        grpCode: c.grp_code,
        codeNm: c.code_nm,
        codeDc: c.code_dc ?? "",
        useYn: c.use_yn,
        sortOrdr: c.sort_ordr,
      })),
    });
  } catch (err) {
    console.error(`[GET /api/code-groups/${grpCode}/codes]`, err);
    return apiError("DB_ERROR", "코드 목록 조회에 실패했습니다.", 500);
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, grpCode } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  let body: { cmCode?: string; codeNm?: string; codeDc?: string; sortOrdr?: number };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const cmCode = body.cmCode?.trim();
  const codeNm = body.codeNm?.trim();
  if (!cmCode) return apiError("VALIDATION_ERROR", "코드를 입력해 주세요.", 400);
  if (!codeNm) return apiError("VALIDATION_ERROR", "코드명을 입력해 주세요.", 400);

  // 코드 형식 검증: 영문대소문자, 숫자, _, :, - 만 허용
  if (!/^[A-Za-z0-9_:\-]+$/.test(cmCode)) {
    return apiError("VALIDATION_ERROR", "코드는 영문, 숫자, _, :, - 만 입력 가능합니다.", 400);
  }

  try {
    // 그룹 존재 확인
    const group = await prisma.tbCmCodeGroup.findUnique({ where: { grp_code: grpCode } });
    if (!group) return apiError("NOT_FOUND", "코드 그룹을 찾을 수 없습니다.", 404);

    // 코드 PK 중복 체크
    const dupPk = await prisma.tbCmCode.findUnique({ where: { cm_code: cmCode } });
    if (dupPk) return apiError("DUPLICATE", "이미 존재하는 코드입니다.", 409);

    // 같은 그룹 내 코드명 중복 체크
    const dup = await prisma.tbCmCode.findUnique({
      where: { grp_code_code_nm: { grp_code: grpCode, code_nm: codeNm } },
    });
    if (dup) return apiError("DUPLICATE", "이미 존재하는 코드명입니다.", 409);

    // 정렬순서 미지정 시 마지막+1
    let sortOrdr = body.sortOrdr ?? -1;
    if (sortOrdr < 0) {
      const last = await prisma.tbCmCode.findFirst({
        where: { grp_code: grpCode },
        orderBy: { sort_ordr: "desc" },
        select: { sort_ordr: true },
      });
      sortOrdr = (last?.sort_ordr ?? 0) + 1;
    }

    const created = await prisma.tbCmCode.create({
      data: {
        cm_code: cmCode,
        grp_code: grpCode,
        code_nm: codeNm,
        code_dc: body.codeDc?.trim() || null,
        sort_ordr: sortOrdr,
        use_yn: "Y",
      },
    });

    return apiSuccess(
      { cmCode: created.cm_code, codeNm: created.code_nm },
      201
    );
  } catch (err) {
    console.error(`[POST /api/code-groups/${grpCode}/codes]`, err);
    return apiError("DB_ERROR", "코드 생성에 실패했습니다.", 500);
  }
}
