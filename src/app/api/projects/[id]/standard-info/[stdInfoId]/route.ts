/**
 * GET    /api/projects/[id]/standard-info/[stdInfoId] — 기준 정보 단건 조회
 * PUT    /api/projects/[id]/standard-info/[stdInfoId] — 기준 정보 수정 (use_yn 토글 포함)
 * DELETE /api/projects/[id]/standard-info/[stdInfoId] — 기준 정보 물리삭제(hard delete)
 *
 * 권한:
 *   - 다른 도메인과 동일하게 requirePermission 단일 함수로 처리.
 *     SUPER_ADMIN 지원 세션은 .read 만 통과, 쓰기성은 자동 차단된다.
 *
 * 보안:
 *   - 단건 조회·수정·삭제 시 행의 prjct_id 가 URL 의 projectId 와 일치하는지 검사.
 *     일치하지 않으면 NOT_FOUND 로 응답 (존재 자체를 노출하지 않기 위해 FORBIDDEN 대신).
 *
 * 토글 판별:
 *   - PUT 본문에 "useYn 만 단독으로" 들어온 경우만 토글로 처리.
 *     (단순히 stdInfoNm 누락 여부만 보면, useYn+stdInfoCode 등 부분 PUT 이 토글로 오인됨)
 *
 * 삭제 정책:
 *   - hard delete 로 행을 즉시 제거.
 *   - (prjct_id, std_info_code, std_bgng_de) 유니크 제약 때문에 논리삭제 흔적이 남으면
 *     같은 코드+시작일로 재등록이 영원히 막힘 → 운영상 불편 + 사용자 혼란.
 *   - 감사 추적이 필요해지면 별도 audit 테이블로 분리.
 *
 * 명명 이력:
 *   - 2026-05-05 reference-info / ref_* → standard-info / std_* 로 통일
 *   - 2026-05-05 전역 → 프로젝트 단위 (prjct_id NOT NULL) 전환
 *   - 2026-05-05 requireAuth+checkRole → requirePermission 으로 표준화
 *   - 2026-05-05 isToggle 판별 강화 (단일키 검사로 오판 차단)
 *   - 2026-05-05 bus_div_code(고정 6종) → biz_ctgry_nm(자유 텍스트 100자) 전환
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; stdInfoId: string }> };

// 기준 일자(YYYYMMDD 8자리). UI maxLength 우회 대비 서버 재검증.
const DATE_RE = /^\d{8}$/;

// ─── GET: 단건 조회 ─────────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, stdInfoId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    const r = await prisma.tbCmStandardInfo.findUnique({ where: { std_info_id: stdInfoId } });
    // 다른 프로젝트의 행이 ID 추측 공격으로 노출되지 않도록 prjct_id 일치 검사
    if (!r || r.del_yn === "Y" || r.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "기준 정보를 찾을 수 없습니다.", 404);
    }

    return apiSuccess({
      stdInfoId:     r.std_info_id,
      stdInfoCode:   r.std_info_code,
      stdBgngDe:     r.std_bgng_de,
      stdEndDe:      r.std_end_de,
      stdInfoNm:     r.std_info_nm,
      bizCtgryNm:    r.biz_ctgry_nm,
      stdDataTyCode: r.std_data_ty_code,
      mainStdVal:    r.main_std_val,
      subStdVal:     r.sub_std_val,
      stdInfoDc:     r.std_info_dc,
      useYn:         r.use_yn,
    });
  } catch (err) {
    console.error(`[GET /standard-info/${stdInfoId}] DB 오류:`, err);
    return apiError("DB_ERROR", "조회에 실패했습니다.", 500);
  }
}

// ─── PUT: 수정 (use_yn 토글 포함) ────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, stdInfoId } = await params;

  const gate = await requirePermission(request, projectId, "content.update");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }
  if (!body || typeof body !== "object") {
    return apiError("VALIDATION_ERROR", "요청 본문이 올바르지 않습니다.", 400);
  }

  const {
    stdInfoCode, stdBgngDe, stdEndDe, stdInfoNm,
    bizCtgryNm, stdDataTyCode, mainStdVal, subStdVal, stdInfoDc, useYn,
  } = body as {
    stdInfoCode?: string; stdBgngDe?: string; stdEndDe?: string;
    stdInfoNm?: string; bizCtgryNm?: string; stdDataTyCode?: string;
    mainStdVal?: string; subStdVal?: string; stdInfoDc?: string; useYn?: string;
  };

  // 토글 판별 — "useYn 한 키만" 들어온 경우만 토글로 인정.
  // 다른 필드와 함께 들어왔다면 일반 update 로 처리해야 변경 의도가 무시되지 않는다.
  const bodyKeys = Object.keys(body);
  const isToggle = bodyKeys.length === 1 && bodyKeys[0] === "useYn" && useYn !== undefined;

  // useYn 값 자체도 검증 — DB Char(1) 제약과 비즈니스 규칙
  if (useYn !== undefined && useYn !== "Y" && useYn !== "N") {
    return apiError("VALIDATION_ERROR", "useYn 은 'Y' 또는 'N' 만 허용됩니다.", 400);
  }

  // 일반 update 인 경우 필수값·날짜 형식 재검증
  let bgngDe = stdBgngDe?.trim();
  let endDe  = stdEndDe?.trim() || null;
  if (!isToggle) {
    if (!stdInfoCode?.trim()) return apiError("VALIDATION_ERROR", "기준 정보 코드를 입력해 주세요.", 400);
    if (!bgngDe)              return apiError("VALIDATION_ERROR", "기준 시작 일자를 입력해 주세요.", 400);
    if (!stdInfoNm?.trim())   return apiError("VALIDATION_ERROR", "기준 정보 명을 입력해 주세요.", 400);
    if (!DATE_RE.test(bgngDe)) {
      return apiError("VALIDATION_ERROR", "기준 시작 일자는 YYYYMMDD 8자리 숫자여야 합니다.", 400);
    }
    if (endDe !== null && !DATE_RE.test(endDe)) {
      return apiError("VALIDATION_ERROR", "기준 종료 일자는 YYYYMMDD 8자리 숫자여야 합니다.", 400);
    }
    if (endDe !== null && endDe < bgngDe) {
      return apiError("VALIDATION_ERROR", "기준 종료 일자는 시작 일자보다 빠를 수 없습니다.", 400);
    }
  }

  try {
    const existing = await prisma.tbCmStandardInfo.findUnique({ where: { std_info_id: stdInfoId } });
    // 다른 프로젝트 행이 ID 추측으로 수정되지 않도록 prjct_id 일치 검사
    if (!existing || existing.del_yn === "Y" || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "기준 정보를 찾을 수 없습니다.", 404);
    }

    await prisma.tbCmStandardInfo.update({
      where: { std_info_id: stdInfoId },
      data: isToggle
        ? { use_yn: useYn, mdfcn_mber_id: gate.mberId, mdfcn_dt: new Date() }
        : {
            std_info_code:    stdInfoCode!.trim(),
            std_bgng_de:      bgngDe!,
            std_end_de:       stdEndDe !== undefined ? endDe : existing.std_end_de,
            std_info_nm:      stdInfoNm!.trim(),
            biz_ctgry_nm:     bizCtgryNm?.trim() || existing.biz_ctgry_nm,
            std_data_ty_code: stdDataTyCode?.trim() || existing.std_data_ty_code,
            main_std_val:     mainStdVal !== undefined ? (mainStdVal?.trim() || null) : existing.main_std_val,
            sub_std_val:      subStdVal !== undefined ? (subStdVal?.trim() || null) : existing.sub_std_val,
            std_info_dc:      stdInfoDc !== undefined ? (stdInfoDc?.trim() || null) : existing.std_info_dc,
            use_yn:           useYn ?? existing.use_yn,
            mdfcn_mber_id:    gate.mberId,
            mdfcn_dt:         new Date(),
          },
    });

    return apiSuccess({ ok: true });
  } catch (err) {
    console.error(`[PUT /standard-info/${stdInfoId}] DB 오류:`, err);
    return apiError("DB_ERROR", "수정에 실패했습니다.", 500);
  }
}

// ─── DELETE: 물리삭제 ────────────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, stdInfoId } = await params;

  const gate = await requirePermission(request, projectId, "content.delete");
  if (gate instanceof Response) return gate;

  try {
    const existing = await prisma.tbCmStandardInfo.findUnique({ where: { std_info_id: stdInfoId } });
    // 다른 프로젝트 행이 ID 추측으로 삭제되지 않도록 prjct_id 일치 검사
    if (!existing || existing.del_yn === "Y" || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "기준 정보를 찾을 수 없습니다.", 404);
    }

    // 물리삭제 — 행 자체를 제거. 동일 (프로젝트, 코드, 시작일) 로 재등록 가능.
    await prisma.tbCmStandardInfo.delete({ where: { std_info_id: stdInfoId } });

    return apiSuccess({ ok: true });
  } catch (err) {
    console.error(`[DELETE /standard-info/${stdInfoId}] DB 오류:`, err);
    return apiError("DB_ERROR", "삭제에 실패했습니다.", 500);
  }
}
