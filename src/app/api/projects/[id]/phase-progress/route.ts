/**
 * 공통 단계별 진척률 API (tb_cm_progress)
 *
 * GET  /api/projects/[id]/phase-progress?refTable=tb_ds_function&refId=xxx
 *   → 해당 기능의 설계·구현 진척률 조회
 *   → 레코드가 없으면 0으로 초기화된 기본값 반환 (404 아님)
 *
 * PUT  /api/projects/[id]/phase-progress?refTable=tb_ds_function&refId=xxx
 *   → 단계별 진척률 저장 (upsert — 없으면 생성, 있으면 수정)
 *   → Body: { designRt?, implRt? }  각 0~100 정수
 *
 * 다형 참조 구조: refTable(참조 테이블명) + refId(참조 레코드 ID)
 * 분석(analyRt)은 2026-07-28 제거됨 — 분석은 요구사항 레벨(TbRqRequirement.progrs_rt)에서
 * 별도 관리하고, 이 테이블은 현재 tb_ds_function 에서만 쓴다.
 *
 * 테스트(testRt)는 2026-07-28 3차 개편으로 이 API 인터페이스에서 제거됨 — DB 컬럼(test_rt)
 * 자체는 향후 자동테스트 연동을 위해 스키마에 남아있지만 이 API는 더 이상 읽지도 쓰지도 않는다.
 */

import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// 응답 형태를 camelCase로 통일
function toResponse(row: {
  design_rt: number;
  impl_rt: number;
}) {
  return {
    designRt: row.design_rt,
    implRt:   row.impl_rt,
  };
}

// 진척률 값 유효성 검사 (0~100 정수)
function isValidRate(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100;
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  // 멤버십 확인 (읽기는 모든 활성 멤버 허용)
  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  const url = new URL(request.url);
  const refTable = url.searchParams.get("refTable");
  const refId    = url.searchParams.get("refId");

  if (!refTable || !refId) {
    return apiError("VALIDATION_ERROR", "refTable과 refId는 필수입니다.", 400);
  }

  try {
    // @@unique([ref_tbl_nm, ref_id]) 인덱스로 조회
    const row = await prisma.tbCmProgress.findUnique({
      where: { ref_tbl_nm_ref_id: { ref_tbl_nm: refTable, ref_id: refId } },
    });

    // 레코드가 없으면 0으로 초기화된 기본값 반환 (첫 접근 시에도 정상 응답)
    if (!row) {
      return apiSuccess({ designRt: 0, implRt: 0 });
    }

    return apiSuccess(toResponse(row));
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/phase-progress] DB 오류:`, err);
    return apiError("DB_ERROR", "진척률 조회 중 오류가 발생했습니다.", 500);
  }
}

// ─── PUT ──────────────────────────────────────────────────────────────────────

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  // 수정은 OWNER·ADMIN·PM·DESIGNER·DEVELOPER만 가능
  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  const url = new URL(request.url);
  const refTable = url.searchParams.get("refTable");
  const refId    = url.searchParams.get("refId");

  if (!refTable || !refId) {
    return apiError("VALIDATION_ERROR", "refTable과 refId는 필수입니다.", 400);
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { designRt, implRt } = body as {
    designRt?: unknown;
    implRt?:  unknown;
  };

  // 전달된 값만 검증 (undefined는 기존 값 유지 — upsert create 시 0이 기본값)
  if (designRt !== undefined && !isValidRate(designRt)) return apiError("VALIDATION_ERROR", "designRt는 0~100 정수여야 합니다.", 400);
  if (implRt   !== undefined && !isValidRate(implRt))   return apiError("VALIDATION_ERROR", "implRt는 0~100 정수여야 합니다.", 400);

  try {
    // upsert — (ref_tbl_nm, ref_id) 기준 없으면 생성, 있으면 수정
    const row = await prisma.tbCmProgress.upsert({
      where: { ref_tbl_nm_ref_id: { ref_tbl_nm: refTable, ref_id: refId } },
      create: {
        // @default(uuid()) 가 schema에 있지만 구버전 Prisma client 호환을 위해 명시 전달
        progrs_id:     randomUUID(),
        ref_tbl_nm:    refTable,
        ref_id:        refId,
        prjct_id:      projectId,
        design_rt:     (designRt as number) ?? 0,
        impl_rt:       (implRt   as number) ?? 0,
        mdfcn_mber_id: auth.mberId,
        mdfcn_dt:      new Date(),
      },
      update: {
        // 전달된 값만 수정 — 나머지는 DB 기존값 유지
        ...(designRt !== undefined ? { design_rt: designRt as number } : {}),
        ...(implRt   !== undefined ? { impl_rt:   implRt   as number } : {}),
        mdfcn_mber_id: auth.mberId,
        mdfcn_dt:      new Date(),
      },
    });

    return apiSuccess(toResponse(row));
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/phase-progress] DB 오류:`, err);
    return apiError("DB_ERROR", "진척률 저장 중 오류가 발생했습니다.", 500);
  }
}
