/**
 * GET  /api/projects/[id]/standard-info — 기준 정보 목록 조회
 * POST /api/projects/[id]/standard-info — 기준 정보 생성
 *
 * 프로젝트별 기준값(key-value) 관리.
 * 모든 조회/생성/수정/삭제는 URL 의 projectId 범위로 제한 (cross-project 차단).
 *
 * 권한:
 *   - 다른 도메인(tasks/screens/areas 등)과 동일하게 requirePermission 단일 함수로 처리.
 *     이래야 SUPER_ADMIN 지원 세션의 읽기 전용 보호도 자동 적용된다.
 *   - content.read   : 모든 멤버 (OWNER/ADMIN/MEMBER/VIEWER)
 *   - content.create : OWNER/ADMIN/MEMBER (PERMISSIONS 맵 기준 — 표준 정책 일치)
 *
 * 명명 이력:
 *   - 2026-05-05 reference-info / ref_* → standard-info / std_* 로 통일
 *   - 2026-05-05 전역 → 프로젝트 단위 (prjct_id NOT NULL) 전환
 *   - 2026-05-05 requireAuth+checkRole → requirePermission 으로 표준화
 *   - 2026-05-05 bus_div_code(고정 6종) → biz_ctgry_nm(자유 텍스트 100자) 전환
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// 기준 시작/종료 일자 — UI 입력은 YYYYMMDD 8자리 숫자.
// 클라이언트에서 maxLength 만 적용되므로 서버에서 반드시 형식·범위 재검증.
const DATE_RE = /^\d{8}$/;

// ─── GET: 기준 정보 목록 조회 ────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    // 프로젝트 범위로 제한 — 다른 프로젝트의 기준 정보는 절대 노출하지 않음
    const items = await prisma.tbCmStandardInfo.findMany({
      where: { prjct_id: projectId, del_yn: "N" },
      orderBy: [{ biz_ctgry_nm: "asc" }, { std_info_code: "asc" }, { std_bgng_de: "desc" }],
    });

    return apiSuccess({
      items: items.map((r) => ({
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
        creatDt:       r.creat_dt,
        mdfcnDt:       r.mdfcn_dt,
      })),
      totalCount: items.length,
    });
  } catch (err) {
    console.error("[GET /api/.../standard-info] DB 오류:", err);
    return apiError("DB_ERROR", "기준 정보 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 기준 정보 생성 ────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const {
    stdInfoCode, stdBgngDe, stdEndDe, stdInfoNm,
    bizCtgryNm, stdDataTyCode, mainStdVal, subStdVal, stdInfoDc, useYn,
  } = body as {
    stdInfoCode?: string; stdBgngDe?: string; stdEndDe?: string;
    stdInfoNm?: string; bizCtgryNm?: string; stdDataTyCode?: string;
    mainStdVal?: string; subStdVal?: string; stdInfoDc?: string;
    useYn?: string;
  };

  if (!stdInfoCode?.trim()) return apiError("VALIDATION_ERROR", "기준 정보 코드를 입력해 주세요.", 400);
  if (!stdBgngDe?.trim()) return apiError("VALIDATION_ERROR", "기준 시작 일자를 입력해 주세요.", 400);
  if (!stdInfoNm?.trim()) return apiError("VALIDATION_ERROR", "기준 정보 명을 입력해 주세요.", 400);
  if (!bizCtgryNm?.trim()) return apiError("VALIDATION_ERROR", "업무 카테고리명을 입력해 주세요.", 400);
  if (bizCtgryNm.trim().length > 100) {
    return apiError("VALIDATION_ERROR", "업무 카테고리명은 100자 이내여야 합니다.", 400);
  }
  if (!stdDataTyCode?.trim()) return apiError("VALIDATION_ERROR", "자료 유형 코드를 선택해 주세요.", 400);

  // 날짜 형식 검증 — UI 의 maxLength 가 우회되어도 가비지 저장 차단
  const bgngDe = stdBgngDe.trim();
  const endDe  = stdEndDe?.trim() || null;
  if (!DATE_RE.test(bgngDe)) {
    return apiError("VALIDATION_ERROR", "기준 시작 일자는 YYYYMMDD 8자리 숫자여야 합니다.", 400);
  }
  if (endDe !== null && !DATE_RE.test(endDe)) {
    return apiError("VALIDATION_ERROR", "기준 종료 일자는 YYYYMMDD 8자리 숫자여야 합니다.", 400);
  }
  if (endDe !== null && endDe < bgngDe) {
    return apiError("VALIDATION_ERROR", "기준 종료 일자는 시작 일자보다 빠를 수 없습니다.", 400);
  }

  // useYn: "Y" | "N" 만 허용. 미지정 시 기본 "Y"
  const normalizedUseYn = useYn === "N" ? "N" : "Y";

  try {
    // 중복 체크: (프로젝트, 코드, 시작일) 유니크 — 다른 프로젝트는 같은 코드 자유 사용 가능
    const dup = await prisma.tbCmStandardInfo.findUnique({
      where: {
        prjct_id_std_info_code_std_bgng_de: {
          prjct_id:      projectId,
          std_info_code: stdInfoCode.trim(),
          std_bgng_de:   bgngDe,
        },
      },
    });
    if (dup) {
      return apiError("VALIDATION_ERROR", "동일한 기준 코드 + 시작일이 이미 존재합니다.", 400);
    }

    const created = await prisma.tbCmStandardInfo.create({
      data: {
        prjct_id:         projectId,  // URL 의 projectId 강제 — body 주입 차단
        std_info_code:    stdInfoCode.trim(),
        std_bgng_de:      bgngDe,
        std_end_de:       endDe,
        std_info_nm:      stdInfoNm.trim(),
        biz_ctgry_nm:     bizCtgryNm.trim(),
        std_data_ty_code: stdDataTyCode.trim(),
        main_std_val:     mainStdVal?.trim() || null,
        sub_std_val:      subStdVal?.trim() || null,
        std_info_dc:      stdInfoDc?.trim() || null,
        use_yn:           normalizedUseYn,
        creat_mber_id:    gate.mberId,
      },
    });

    return apiSuccess({ stdInfoId: created.std_info_id }, 201);
  } catch (err) {
    console.error("[POST /api/.../standard-info] DB 오류:", err);
    return apiError("DB_ERROR", "기준 정보 생성에 실패했습니다.", 500);
  }
}
