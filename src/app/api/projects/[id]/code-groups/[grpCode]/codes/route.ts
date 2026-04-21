/**
 * GET  /api/projects/[id]/code-groups/[grpCode]/codes — 코드 목록 조회
 * POST /api/projects/[id]/code-groups/[grpCode]/codes — 코드 생성
 *
 * 역할:
 *   - 프로젝트 스코프 — params.id(prjct_id) + params.grpCode로 그룹 조회
 *   - 특정 코드 그룹의 코드 목록 조회 (sort_ordr → creat_dt 순)
 *   - 신규 코드 등록 (그룹 내 cm_code 중복 검증, 선택적 전역 유니크 검증)
 *   - 정렬순서 미지정 시 마지막+1 자동 계산
 *
 * 주요 기술:
 *   - cm_code_id: serial PK (내부 식별자)
 *   - cm_code: 사용자 입력 코드값 (영문/숫자/_/:/- 만 허용)
 *   - 같은 그룹 내 cm_code 중복 금지 (DB 제약), code_nm은 자유 입력
 *   - globalUnique=true: 같은 프로젝트 내 모든 그룹 cm_code 중복 검증
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; grpCode: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, grpCode } = await params;

  const gate = await requirePermission(request, projectId, "code.read");
  if (gate instanceof Response) return gate;

  try {
    // 프로젝트 스코프로 그룹 조회 → 코드 목록
    const group = await prisma.tbCmCodeGroup.findUnique({
      where: { prjct_id_grp_code: { prjct_id: projectId, grp_code: grpCode } },
    });
    if (!group) return apiError("NOT_FOUND", "코드 그룹을 찾을 수 없습니다.", 404);

    const codes = await prisma.tbCmCode.findMany({
      where: { grp_code_id: group.grp_code_id },
      orderBy: [{ sort_ordr: "asc" }, { creat_dt: "asc" }],
    });

    return apiSuccess({
      items: codes.map((c) => ({
        codeId: c.cm_code_id,
        cmCode: c.cm_code,
        grpCode: group.grp_code,
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
  const { id: projectId, grpCode } = await params;

  const gate = await requirePermission(request, projectId, "code.write");
  if (gate instanceof Response) return gate;

  let body: { cmCode?: string; codeNm?: string; codeDc?: string; sortOrdr?: number; globalUnique?: boolean };
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
    // 프로젝트 스코프로 그룹 조회
    const group = await prisma.tbCmCodeGroup.findUnique({
      where: { prjct_id_grp_code: { prjct_id: projectId, grp_code: grpCode } },
    });
    if (!group) return apiError("NOT_FOUND", "코드 그룹을 찾을 수 없습니다.", 404);

    // 같은 그룹 내 cm_code 중복 체크 (필수)
    const dupInGroup = await prisma.tbCmCode.findFirst({
      where: { grp_code_id: group.grp_code_id, cm_code: cmCode },
    });
    if (dupInGroup) return apiError("DUPLICATE", "같은 그룹 내에 이미 존재하는 코드입니다.", 409);

    // globalUnique 옵션: 같은 프로젝트 내 모든 그룹에서 cm_code 중복 체크
    if (body.globalUnique) {
      const dupGlobal = await prisma.tbCmCode.findFirst({
        where: { prjct_id: projectId, cm_code: cmCode },
      });
      if (dupGlobal) return apiError("DUPLICATE", "프로젝트 내 다른 그룹에 이미 존재하는 코드입니다.", 409);
    }

    // 정렬순서 미지정 시 마지막+1
    let sortOrdr = body.sortOrdr ?? -1;
    if (sortOrdr < 0) {
      const last = await prisma.tbCmCode.findFirst({
        where: { grp_code_id: group.grp_code_id },
        orderBy: { sort_ordr: "desc" },
        select: { sort_ordr: true },
      });
      sortOrdr = (last?.sort_ordr ?? 0) + 1;
    }

    const created = await prisma.tbCmCode.create({
      data: {
        prjct_id: projectId,
        grp_code_id: group.grp_code_id,
        cm_code: cmCode,
        code_nm: codeNm,
        code_dc: body.codeDc?.trim() || null,
        sort_ordr: sortOrdr,
        use_yn: "Y",
      },
    });

    return apiSuccess(
      { codeId: created.cm_code_id, cmCode: created.cm_code, codeNm: created.code_nm },
      201
    );
  } catch (err) {
    console.error(`[POST /api/code-groups/${grpCode}/codes]`, err);
    return apiError("DB_ERROR", "코드 생성에 실패했습니다.", 500);
  }
}
